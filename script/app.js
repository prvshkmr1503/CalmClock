// script/app.js
// CalmClock — Full Version (timer + logs + stats + settings)
// ----------------------------------------------------------

// ---------- DOM ----------
const el = (id) => document.getElementById(id);

const timerDisplay = el("timerDisplay");
const startBtn = el("startBtn");
const pauseBtn = el("pauseBtn");
const resetBtn = el("resetBtn");
const sessionTypeSel = el("sessionType");
const sessionCountEl = el("sessionCount");

const statSessions = el("statSessions");
const statMinutes = el("statMinutes");
const statStreak = el("statStreak");

const logBody = el("logBody");
const exportLogsBtn = el("exportLogsBtn");
const clearLogsBtn = el("clearLogsBtn");

const noteForm = el("noteForm");
const noteInput = el("noteInput");

const openSettingsBtn = el("openSettingsBtn");
const settingsDialog = el("settingsDialog");
const closeSettingsBtn = el("closeSettingsBtn");
const focusLenInput = el("focusLen");
const shortBreakLenInput = el("shortBreakLen");
const longBreakLenInput = el("longBreakLen");
const longBreakEveryInput = el("longBreakEvery");
const soundToggle = el("soundToggle");
const autoNextToggle = el("autoNextToggle");
const saveSettingsBtn = el("saveSettingsBtn");

const dingSound = el("dingSound");

const yearEl = el("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ---------- Storage Keys ----------
const LS_SETTINGS_KEY = "calmclock_settings";
const LS_LOGS_KEY = "calmclock_logs";

// ---------- Defaults ----------
const DEFAULTS = {
  focusLen: 25,         // minutes
  shortBreakLen: 5,     // minutes
  longBreakLen: 15,     // minutes
  longBreakEvery: 4,    // after N focus sessions
  soundEnabled: true,
  autoNext: false
};

// ---------- State ----------
let settings = loadSettings();
let currentType = "focus";                 // 'focus' | 'shortBreak' | 'longBreak'
let secondsLeft = settings.focusLen * 60;  // countdown seconds
let timerId = null;
let running = false;
let sessionStartTs = null;                 // unix ms when session started
let completedFocusCount = 0;               // cycles since last long break
let lastLoggedId = null;                   // for attaching notes
let todayKey = dateKey(new Date());

// Quick init UI
applySettingsToUI();
renderTimer();
renderSessionMeta();
renderLogs();
renderStats();

// ---------- Helpers ----------
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(next) {
  settings = { ...settings, ...next };
  localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
}

function getLogs() {
  try {
    const raw = localStorage.getItem(LS_LOGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setLogs(arr) {
  localStorage.setItem(LS_LOGS_KEY, JSON.stringify(arr));
}

function dateKey(d) {
  // YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function fmtTime(mins, secs) {
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function humanDuration(sec) {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function nextTypeAfterFocus() {
  return (completedFocusCount % settings.longBreakEvery === 0)
    ? "longBreak"
    : "shortBreak";
}

function typeLabel(t) {
  return t === "focus" ? "Focus" : t === "shortBreak" ? "Short Break" : "Long Break";
}

function typeLenMin(t) {
  if (t === "focus") return settings.focusLen;
  if (t === "shortBreak") return settings.shortBreakLen;
  return settings.longBreakLen;
}

// ---------- UI Rendering ----------
function renderTimer() {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  timerDisplay.textContent = fmtTime(m, s);
}

function renderSessionMeta() {
  // Show count towards long break only for focus
  if (currentType === "focus") {
    const toLong = settings.longBreakEvery - ((completedFocusCount) % settings.longBreakEvery);
    sessionCountEl.textContent = `Focus #${(completedFocusCount % settings.longBreakEvery) + 1} · ${toLong} to long break`;
  } else {
    sessionCountEl.textContent = typeLabel(currentType);
  }
  sessionTypeSel.value = currentType;
}

function renderLogs() {
  const logs = getLogs().slice().reverse(); // newest first
  logBody.innerHTML = "";
  if (logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-row";
    empty.innerHTML = `<span>No sessions yet</span><span>—</span><span>—</span><span>—</span>`;
    logBody.appendChild(empty);
    return;
  }

  logs.forEach((l) => {
    const row = document.createElement("div");
    row.className = "log-row";
    const when = new Date(l.end || l.start);
    const whenStr = when.toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
    row.innerHTML = `
      <span>${whenStr}</span>
      <span>${typeLabel(l.type)}</span>
      <span>${humanDuration(l.durationSec)}</span>
      <div>${l.note ? escapeHTML(l.note) : "<span class='muted'>—</span>"}</div>
    `;
    logBody.appendChild(row);
  });
}

function renderStats() {
  const logs = getLogs();
  // Today stats
  const today = logs.filter(l => dateKey(new Date(l.start)) === todayKey && l.type === "focus");
  const totalSec = today.reduce((a, b) => a + (b.durationSec || 0), 0);
  statSessions.textContent = today.length.toString();
  statMinutes.textContent = `${Math.round(totalSec / 60)}m`;

  // Best streak = max consecutive days with ≥1 focus session
  const daysWithFocus = new Set(
    logs.filter(l => l.type === "focus").map(l => dateKey(new Date(l.start)))
  );
  statStreak.textContent = String(computeBestConsecutiveStreak(daysWithFocus));
}

function computeBestConsecutiveStreak(daySet) {
  if (daySet.size === 0) return 0;
  // Build sorted unique dates
  const arr = Array.from(daySet).sort();
  // Convert to Date objects at midnight
  const dArr = arr.map(k => new Date(k + "T00:00:00"));
  let best = 1, cur = 1;
  for (let i = 1; i < dArr.length; i++) {
    const diff = (dArr[i] - dArr[i - 1]) / (24 * 3600 * 1000);
    if (diff === 1) cur++;
    else cur = 1;
    if (cur > best) best = cur;
  }
  return best;
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

// ---------- Core Timer ----------
function setType(t) {
  currentType = t;
  secondsLeft = typeLenMin(t) * 60;
  sessionStartTs = null;
  running = false;
  clearInterval(timerId);
  timerId = null;

  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = false;

  renderSessionMeta();
  renderTimer();
}

function startTimer() {
  if (running) return;
  if (!sessionStartTs) sessionStartTs = Date.now();

  running = true;
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  resetBtn.disabled = false;

  tick(); // update immediately
  timerId = setInterval(tick, 1000);
}

function pauseTimer() {
  if (!running) return;
  running = false;
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  clearInterval(timerId);
  timerId = null;
}

function resetTimer() {
  running = false;
  clearInterval(timerId);
  timerId = null;

  secondsLeft = typeLenMin(currentType) * 60;
  sessionStartTs = null;

  startBtn.disabled = false;
  pauseBtn.disabled = true;
  resetBtn.disabled = true;

  renderTimer();
}

function tick() {
  secondsLeft = Math.max(0, secondsLeft - 1);
  renderTimer();

  if (secondsLeft === 0) {
    clearInterval(timerId);
    timerId = null;
    running = false;
    onSessionComplete();
  }
}

function onSessionComplete() {
  // Log the session
  const end = Date.now();
  const plannedSec = typeLenMin(currentType) * 60;
  const actualSec = sessionStartTs ? Math.max(1, Math.round((end - sessionStartTs) / 1000)) : plannedSec;

  const logItem = {
    id: cryptoRandomId(),
    type: currentType,
    start: sessionStartTs || (end - plannedSec * 1000),
    end,
    durationSec: Math.min(Math.max(actualSec, 1), plannedSec * 3), // guard
    note: ""
  };

  const logs = getLogs();
  logs.push(logItem);
  setLogs(logs);
  lastLoggedId = logItem.id;

  // Update counts
  if (currentType === "focus") {
    completedFocusCount += 1;
  }

  // Sound
  if (settings.soundEnabled) {
    try { dingSound.currentTime = 0; dingSound.play().catch(() => {}); } catch {}
  }

  // Refresh UI
  renderLogs();
  // Update "todayKey" if date changed past midnight
  todayKey = dateKey(new Date());
  renderStats();

  // Auto-next or stop
  if (settings.autoNext) {
    if (currentType === "focus") {
      // decide short/long break
      const next = nextTypeAfterFocus();
      setType(next);
      startTimer(); // auto start
    } else {
      setType("focus");
      startTimer();
    }
  } else {
    // Prepare next type but do not start
    if (currentType === "focus") {
      setType(nextTypeAfterFocus());
    } else {
      setType("focus");
    }
  }
}

// ---------- Events ----------
startBtn.addEventListener("click", startTimer);
pauseBtn.addEventListener("click", pauseTimer);
resetBtn.addEventListener("click", resetTimer);

sessionTypeSel.addEventListener("change", (e) => {
  const t = e.target.value;
  // if changing away mid-session, confirm
  if (running) {
    const ok = confirm("Switch session type now? Current timer will reset.");
    if (!ok) { sessionTypeSel.value = currentType; return; }
  }
  setType(t);
});

document.querySelectorAll(".chip[data-min]").forEach(btn => {
  btn.addEventListener("click", () => {
    const mins = Number(btn.getAttribute("data-min"));
    // Presets always set to Focus
    currentType = "focus";
    sessionTypeSel.value = "focus";
    secondsLeft = mins * 60;
    running = false;
    clearInterval(timerId);
    timerId = null;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    resetBtn.disabled = false;
    renderSessionMeta();
    renderTimer();
  });
});

// Export logs
exportLogsBtn.addEventListener("click", () => {
  const logs = getLogs();
  if (!logs.length) { alert("No logs to export yet."); return; }
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `calmclock-logs-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// Clear logs
clearLogsBtn.addEventListener("click", () => {
  if (!getLogs().length) { alert("Log is already empty."); return; }
  const ok = confirm("This will permanently delete all logs. Continue?");
  if (!ok) return;
  setLogs([]);
  lastLoggedId = null;
  renderLogs();
  renderStats();
});

// Note form
noteForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const txt = (noteInput.value || "").trim();
  if (!txt) return;
  const logs = getLogs();
  if (!logs.length) { alert("No session to attach a note to."); return; }

  // Attach to last completed session (by lastLoggedId if available; otherwise latest log)
  let idx = -1;
  if (lastLoggedId) {
    idx = logs.findIndex(l => l.id === lastLoggedId);
  }
  if (idx === -1) idx = logs.length - 1;

  logs[idx].note = txt;
  setLogs(logs);
  noteInput.value = "";
  renderLogs();
});

// Settings open/close
openSettingsBtn.addEventListener("click", () => {
  applySettingsToUI();
  settingsDialog.showModal();
});
closeSettingsBtn.addEventListener("click", (e) => {
  e.preventDefault();
  settingsDialog.close();
});

// Save settings
saveSettingsBtn.addEventListener("click", (e) => {
  e.preventDefault();
  const next = {
    focusLen: clampInt(focusLenInput.value, 1, 180, DEFAULTS.focusLen),
    shortBreakLen: clampInt(shortBreakLenInput.value, 1, 60, DEFAULTS.shortBreakLen),
    longBreakLen: clampInt(longBreakLenInput.value, 1, 90, DEFAULTS.longBreakLen),
    longBreakEvery: clampInt(longBreakEveryInput.value, 1, 12, DEFAULTS.longBreakEvery),
    soundEnabled: !!soundToggle.checked,
    autoNext: !!autoNextToggle.checked
  };
  saveSettings(next);

  // If current session type matches, reset its length to new default
  secondsLeft = typeLenMin(currentType) * 60;
  renderTimer();
  renderSessionMeta();

  settingsDialog.close();
});

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function applySettingsToUI() {
  focusLenInput.value = settings.focusLen;
  shortBreakLenInput.value = settings.shortBreakLen;
  longBreakLenInput.value = settings.longBreakLen;
  longBreakEveryInput.value = settings.longBreakEvery;
  soundToggle.checked = !!settings.soundEnabled;
  autoNextToggle.checked = !!settings.autoNext;
}

// ---------- Start State ----------
setType("focus"); // ensures UI consistent

// ---------- Misc ----------
function cryptoRandomId() {
  // fallback-safe
  if (window.crypto && crypto.getRandomValues) {
    const arr = new Uint32Array(4);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(n => n.toString(16).padStart(8, "0")).join("-");
  }
  return "id-" + Math.random().toString(36).slice(2) + Date.now();
}

// Update stats at midnight without reload
setInterval(() => {
  const nowKey = dateKey(new Date());
  if (nowKey !== todayKey) {
    todayKey = nowKey;
    renderStats();
  }
}, 60 * 1000);
