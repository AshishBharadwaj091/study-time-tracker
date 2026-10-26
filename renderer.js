const $ = (id) => document.getElementById(id);

let data = null;
let ticker = null;
let toastTimer = null;
let activeView = 'dashboard';
let selectedNoteId = null;
let modalMode = null; // 'exam' | 'task'
let editingItemId = null;

const pad = (n) => String(n).padStart(2, '0');

const SUBJECT_COLORS = {
  general: '#f97316',
  maths: '#fb923c',
  science: '#10b981',
  coding: '#f59e0b',
  english: '#f43f5e',
  reading: '#fbbf24'
};

function getSubjectColor(subject) {
  const key = (subject || '').trim().toLowerCase();
  return SUBJECT_COLORS[key] || '#f97316';
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatClock(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatMMSS(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${pad(m)}:${pad(s)}`;
}

function formatDuration(seconds, alwaysShowHours = false) {
  const mins = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(mins / 60);
  if (alwaysShowHours || hours > 0) {
    return `${hours}h ${pad(mins % 60)}m`;
  }
  return `${mins}m`;
}

function sessionSeconds(session) {
  return Math.max(0, Number(session.seconds) || 0);
}

// ----------------------------------------------------
// WEB AUDIO SYNTH CHIME & DESKTOP NOTIFICATIONS
// ----------------------------------------------------
function playChime() {
  if (data && data.settings && data.settings.soundEnabled === false) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15); // E5
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.35); // G5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 1.0);
  } catch (err) {
    console.warn('Audio chime skipped:', err);
  }
}

function notifyUser(title, body) {
  if (data && data.settings && data.settings.notificationsEnabled === false) return;
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: 'icon.ico' });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(title, { body });
      });
    }
  }
}

// ----------------------------------------------------
// DATA PERSISTENCE & TOAST
// ----------------------------------------------------
async function save() {
  if (!data) return;
  await window.studyAPI.saveData(data);
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

// ----------------------------------------------------
// TIMER MATH: ACCURATE TIMESTAMP-BASED TIMERS
// ----------------------------------------------------
function currentElapsedManual() {
  const t = data.timer;
  return (Number(t.elapsedBeforeStart) || 0) + (t.running && t.startedAt ? Math.max(0, (Date.now() - t.startedAt) / 1000) : 0);
}

function currentElapsedPomodoro() {
  const p = data.pomodoro;
  return (Number(p.elapsedBeforeStart) || 0) + (p.running && p.startedAt ? Math.max(0, (Date.now() - p.startedAt) / 1000) : 0);
}

function currentRemainingPomodoro() {
  const p = data.pomodoro;
  const target = Number(p.targetDuration) || 1500;
  const elapsed = currentElapsedPomodoro();
  return Math.max(0, target - elapsed);
}

// ----------------------------------------------------
// AGGREGATION & TOTALS (Derives from real sessions)
// ----------------------------------------------------
function totals() {
  const today = dateKey();
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - day);
  const weekStart = dateKey(monday);

  const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

  let todaySeconds = 0;
  let weekSeconds = 0;
  let monthSeconds = 0;
  let monthCount = 0;

  for (const s of data.sessions) {
    const secs = sessionSeconds(s);
    if (s.date === today) todaySeconds += secs;
    if (s.date >= weekStart && s.date <= today) weekSeconds += secs;
    if (s.date >= monthStart && s.date <= today) {
      monthSeconds += secs;
      monthCount++;
    }
  }

  // Include live elapsed time if manual timer is running today
  if (data.timer.running && data.timer.startedAt) {
    const live = currentElapsedManual();
    if (dateKey(new Date(data.timer.startedAt)) === today) todaySeconds += live;
    if (dateKey(new Date(data.timer.startedAt)) >= weekStart) weekSeconds += live;
    if (dateKey(new Date(data.timer.startedAt)) >= monthStart) monthSeconds += live;
  }

  // Include live elapsed time if Pomodoro focus mode is running today (breaks do NOT count as study time!)
  if (data.pomodoro.running && data.pomodoro.startedAt && data.pomodoro.mode === 'focus') {
    const livePomo = currentElapsedPomodoro();
    if (dateKey(new Date(data.pomodoro.startedAt)) === today) todaySeconds += livePomo;
    if (dateKey(new Date(data.pomodoro.startedAt)) >= weekStart) weekSeconds += livePomo;
    if (dateKey(new Date(data.pomodoro.startedAt)) >= monthStart) monthSeconds += livePomo;
  }

  return { todaySeconds, weekSeconds, monthSeconds, monthCount };
}

// ----------------------------------------------------
// VIEW NAVIGATION
// ----------------------------------------------------
function switchView(viewName) {
  activeView = viewName;

  // Update tabs
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-view') === viewName);
  });

  // Update view containers
  document.querySelectorAll('.app-view').forEach((view) => {
    view.classList.toggle('active', view.id === `view-${viewName}`);
  });

  // Refresh view-specific rendering
  if (viewName === 'analytics') renderAnalytics();
  if (viewName === 'planner') renderPlanner();
  if (viewName === 'notes') renderNotes();
  if (viewName === 'achievements') renderAchievements();
  if (viewName === 'settings') renderSettings();
  if (viewName === 'pomodoro') renderPomodoro();
  if (viewName === 'dashboard') renderDashboard();
}

// ----------------------------------------------------
// MANUAL TIMER CONTROLS (Dashboard)
// ----------------------------------------------------
function syncControls() {
  const running = data.timer.running;
  const hasElapsed = currentElapsedManual() > 0;
  $('start-btn').disabled = running;
  $('pause-btn').disabled = !running;
  $('finish-btn').disabled = !hasElapsed;
  $('subject-select').disabled = running;

  const currentSubject = running ? (data.timer.subject || 'General') : ($('subject-select').value || 'General');

  if ($('active-subject-badge')) {
    $('active-subject-badge').textContent = currentSubject;
    const color = getSubjectColor(currentSubject);
    $('active-subject-badge').style.borderColor = color + '66';
    $('active-subject-badge').style.color = color;
  }

  if ($('session-badge')) {
    if (running) {
      $('session-badge').textContent = 'RECORDING';
      $('session-badge').style.color = '#fb923c';
      $('session-badge').style.borderColor = 'rgba(249, 115, 22, 0.45)';
    } else if (hasElapsed) {
      $('session-badge').textContent = 'PAUSED';
      $('session-badge').style.color = 'var(--accent-gold)';
      $('session-badge').style.borderColor = 'rgba(245, 158, 11, 0.45)';
    } else {
      $('session-badge').textContent = 'FOCUS SESSION';
      $('session-badge').style.color = 'var(--primary-light)';
      $('session-badge').style.borderColor = 'rgba(249, 115, 22, 0.35)';
    }
  }

  const orb = $('focus-orb');
  if (orb) {
    orb.classList.toggle('active', running);
    orb.classList.toggle('paused', !running && hasElapsed);
  }

  if ($('orb-status-text')) {
    $('orb-status-text').textContent = running ? 'ACTIVE' : hasElapsed ? 'PAUSED' : 'IDLE';
  }

  $('timer-status').textContent = running
    ? `You're focusing on ${data.timer.subject}. Keep the momentum going!`
    : hasElapsed ? 'Session paused. Take a breath and resume when ready.' : 'Ready when you are. Select a subject and start.';
}

async function startManual() {
  // Prevent multiple timers running simultaneously
  if (data.pomodoro.running) {
    pausePomodoroSilent();
    showToast('Pomodoro paused to start manual timer');
  }

  data.activeTimerType = 'manual';
  const alreadyElapsed = currentElapsedManual();
  const subject = alreadyElapsed > 0 ? (data.timer.subject || 'General') : ($('subject-select').value || 'General');
  data.timer = { running: true, subject, startedAt: Date.now(), elapsedBeforeStart: alreadyElapsed };
  await save();
  renderDashboard();
  showToast(alreadyElapsed > 0 ? 'Study session resumed' : 'Study session started');
}

async function pauseManual() {
  data.timer.elapsedBeforeStart = currentElapsedManual();
  data.timer.running = false;
  data.timer.startedAt = null;
  await save();
  renderDashboard();
  showToast('Timer paused');
}

async function finishManual() {
  const seconds = Math.floor(currentElapsedManual());
  if (seconds < 1) {
    showToast('Study for at least a second before finishing');
    return;
  }
  data.sessions.push({
    subject: data.timer.subject || 'General',
    seconds,
    date: dateKey(),
    startedAt: Date.now() - seconds * 1000,
    endedAt: Date.now(),
    type: 'manual'
  });
  data.timer = { running: false, subject: $('subject-select').value || 'General', startedAt: null, elapsedBeforeStart: 0 };
  await save();
  checkAchievements();
  lastRenderedSessionsKey = null;
  renderDashboard();
  showToast(`Session saved · ${formatDuration(seconds)}`);
}

function syncGoalInputs(force = false) {
  const totalMins = Math.max(1, Number(data.goalMinutes) || 240);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const hInput = $('goal-hours');
  const mInput = $('goal-mins');
  if (hInput && (force || document.activeElement !== hInput)) {
    hInput.value = h;
  }
  if (mInput && (force || document.activeElement !== mInput)) {
    mInput.value = m;
  }
}

async function saveGoal() {
  const hVal = ($('goal-hours').value || '').trim();
  const mVal = ($('goal-mins').value || '').trim();
  const h = Math.max(0, parseInt(hVal, 10) || 0);
  const m = Math.max(0, parseInt(mVal, 10) || 0);
  const total = h * 60 + m;
  if (total < 1) {
    showToast('Please set a goal of at least 1 minute');
    return;
  }
  if (total > 1440) {
    showToast('Goal cannot exceed 24 hours per day');
    return;
  }
  data.goalMinutes = total;
  await save();
  syncGoalInputs(true);
  renderDashboard();
  showToast(`Daily goal saved: ${formatDuration(total * 60, true)}`);
}

// ----------------------------------------------------
// POMODORO FOCUS TIMER (Feature 1)
// ----------------------------------------------------
function getPomodoroTarget(mode) {
  const s = data.pomodoro.settings || {};
  if (mode === 'shortBreak') return (Number(s.shortBreakDuration) || 5) * 60;
  if (mode === 'longBreak') return (Number(s.longBreakDuration) || 15) * 60;
  return (Number(s.focusDuration) || 25) * 60;
}

function pauseManualSilent() {
  if (data.timer.running) {
    data.timer.elapsedBeforeStart = currentElapsedManual();
    data.timer.running = false;
    data.timer.startedAt = null;
  }
}

function pausePomodoroSilent() {
  if (data.pomodoro.running) {
    data.pomodoro.elapsedBeforeStart = currentElapsedPomodoro();
    data.pomodoro.running = false;
    data.pomodoro.startedAt = null;
  }
}

async function switchPomodoroMode(mode) {
  data.pomodoro.mode = mode;
  data.pomodoro.running = false;
  data.pomodoro.startedAt = null;
  data.pomodoro.elapsedBeforeStart = 0;
  data.pomodoro.targetDuration = getPomodoroTarget(mode);
  await save();
  renderPomodoro();
}

async function togglePomodoro() {
  const p = data.pomodoro;
  if (p.running) {
    p.elapsedBeforeStart = currentElapsedPomodoro();
    p.running = false;
    p.startedAt = null;
    await save();
    showToast('Pomodoro paused');
  } else {
    // Prevent multiple timers
    if (data.timer.running) {
      pauseManualSilent();
      showToast('Manual study timer paused');
    }
    data.activeTimerType = 'pomodoro';
    const already = currentElapsedPomodoro();
    p.running = true;
    p.startedAt = Date.now();
    p.elapsedBeforeStart = already;
    p.subject = $('pomo-subject-select').value || 'General';
    await save();
    showToast(`${p.mode === 'focus' ? 'Focus' : 'Break'} started`);
  }
  renderPomodoro();
}

async function resetPomodoro() {
  const p = data.pomodoro;
  p.running = false;
  p.startedAt = null;
  p.elapsedBeforeStart = 0;
  p.targetDuration = getPomodoroTarget(p.mode);
  await save();
  renderPomodoro();
  showToast('Pomodoro reset');
}

async function finishOrSkipPomodoro() {
  const p = data.pomodoro;
  const isFocus = p.mode === 'focus';
  const elapsed = Math.floor(currentElapsedPomodoro());

  if (isFocus) {
    // Record study session only for completed focus duration
    const recordedSecs = Math.max(elapsed, 1);
    data.sessions.push({
      subject: p.subject || 'General',
      seconds: recordedSecs,
      date: dateKey(),
      startedAt: Date.now() - recordedSecs * 1000,
      endedAt: Date.now(),
      type: 'pomodoro'
    });
    p.completedSessions = (p.completedSessions || 0) + 1;
    playChime();
    notifyUser('Pomodoro Focus Complete! 🎉', `Great job! Session completed for ${p.subject}. Take a break!`);
    showToast(`Focus session saved · ${formatDuration(recordedSecs)}`);
    checkAchievements();

    // Transition to break
    const interval = Number(p.settings.longBreakInterval) || 4;
    const nextMode = p.completedSessions % interval === 0 ? 'longBreak' : 'shortBreak';
    await switchPomodoroMode(nextMode);
  } else {
    // Break finished or skipped (Breaks are NEVER added to study time)
    playChime();
    notifyUser('Break Over!', 'Time to get back in the focus zone!');
    showToast('Break finished');
    await switchPomodoroMode('focus');
  }
}

// Check if active Pomodoro has reached zero during tick
function checkPomodoroAutoFinish() {
  const p = data.pomodoro;
  if (!p.running) return;
  const remaining = currentRemainingPomodoro();
  if (remaining <= 0) {
    finishOrSkipPomodoro();
  }
}

function renderPomodoro() {
  if (!data) return;
  const p = data.pomodoro;
  const remaining = currentRemainingPomodoro();
  const target = Number(p.targetDuration) || 1500;

  // Update mode buttons
  ['focus', 'shortBreak', 'longBreak'].forEach((m) => {
    const btn = $(`pomo-mode-${m === 'shortBreak' ? 'short' : m === 'longBreak' ? 'long' : 'focus'}`);
    if (btn) btn.classList.toggle('active', p.mode === m);
  });

  // Update circle and clock
  $('pomo-clock-display').textContent = formatMMSS(remaining);
  $('pomo-status-tag').textContent = p.mode === 'focus' ? 'FOCUS TIME' : p.mode === 'shortBreak' ? 'SHORT BREAK' : 'LONG BREAK';

  const frac = Math.max(0, Math.min(1, remaining / target));
  const circumference = 2 * Math.PI * 120; // ~753.98
  const offset = circumference * (1 - frac);
  const ring = $('pomo-progress-ring');
  if (ring) {
    ring.style.strokeDashoffset = offset;
    ring.style.stroke = p.mode === 'focus' ? 'var(--primary)' : 'var(--accent-green)';
  }

  // Update controls
  $('pomo-start-btn-text').textContent = p.running ? 'Pause' : p.mode === 'focus' ? 'Start Focus' : 'Start Break';

  // Cycle & dots
  const interval = Number(p.settings.longBreakInterval) || 4;
  const currentCycle = ((p.completedSessions || 0) % interval) + 1;
  $('pomo-cycle-text').textContent = p.mode === 'focus' ? `Session ${currentCycle} of ${interval}` : 'Break in progress';
  $('pomo-total-completed').textContent = `${p.completedSessions || 0} completed`;

  const dotsRow = $('pomo-dots-row');
  if (dotsRow) {
    dotsRow.innerHTML = '';
    for (let i = 1; i <= interval; i++) {
      const dot = document.createElement('span');
      dot.className = 'pomo-dot';
      if (i < currentCycle) dot.classList.add('completed');
      if (i === currentCycle) dot.classList.add('active');
      dot.textContent = i;
      dotsRow.appendChild(dot);
    }
  }

  // Sync subject select
  if ($('pomo-subject-select')) {
    $('pomo-subject-select').value = p.subject || 'General';
  }
}

// ----------------------------------------------------
// DASHBOARD RENDERING (View 1)
// ----------------------------------------------------
let lastRenderedSessionsKey = null;

function renderDashboard() {
  const { todaySeconds, weekSeconds } = totals();
  $('today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  $('timer-display').textContent = formatClock(currentElapsedManual());
  $('today-total').textContent = formatDuration(todaySeconds, true);
  $('week-total').textContent = formatDuration(weekSeconds, true);

  const goalSeconds = Math.max(60, Number(data.goalMinutes) || 240) * 60;
  const pct = Math.min(100, Math.round((todaySeconds / goalSeconds) * 100));
  $('goal-total').textContent = `${pct}%`;
  $('goal-progress').style.width = `${pct}%`;
  $('goal-caption').textContent = `${formatDuration(todaySeconds, true)} of ${formatDuration(goalSeconds, true)} goal`;
  $('session-count').textContent = `${data.sessions.length} session${data.sessions.length === 1 ? '' : 's'}`;

  renderHistory();
  syncControls();
}

function renderHistory() {
  const sessions = data.sessions;
  const key = sessions.length + (sessions.length ? ':' + sessions[sessions.length - 1].endedAt : '');
  if (key === lastRenderedSessionsKey) return;
  lastRenderedSessionsKey = key;
  const list = $('history-list');
  const sorted = [...sessions].sort((a, b) => b.endedAt - a.endedAt).slice(0, 30);

  if (!sorted.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon-wrap">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <strong>Your first session starts here</strong>
        <p>Complete a study session and it will show up here.</p>
      </div>`;
    return;
  }

  list.innerHTML = '';
  for (const s of sorted) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const dot = document.createElement('span');
    dot.className = 'subject-dot';
    dot.style.color = getSubjectColor(s.subject);

    const main = document.createElement('div');
    main.className = 'history-main';
    const subject = document.createElement('div');
    subject.className = 'history-subject';
    subject.textContent = s.subject || 'General';
    const date = document.createElement('div');
    date.className = 'history-date';
    date.textContent = new Date(s.endedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    const duration = document.createElement('div');
    duration.className = 'history-duration';
    duration.textContent = formatDuration(sessionSeconds(s));

    const del = document.createElement('button');
    del.className = 'history-del-btn';
    del.title = 'Delete this session';
    del.setAttribute('aria-label', 'Delete session');
    del.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    del.onclick = async (e) => {
      e.stopPropagation();
      const idx = data.sessions.indexOf(s);
      if (idx !== -1) {
        data.sessions.splice(idx, 1);
        await save();
        lastRenderedSessionsKey = null;
        renderDashboard();
        showToast('Session removed');
      }
    };

    main.append(subject, date);
    item.append(dot, main, duration, del);
    list.append(item);
  }
}

// ----------------------------------------------------
// STUDY ANALYTICS DASHBOARD & HEATMAP (Feature 2)
// ----------------------------------------------------
function renderAnalytics() {
  if (!data) return;
  const { todaySeconds, weekSeconds, monthSeconds, monthCount } = totals();

  $('analytics-month-total').textContent = formatDuration(monthSeconds, true);
  $('analytics-month-count').textContent = `${monthCount} session${monthCount === 1 ? '' : 's'} recorded`;

  // Calculate daily active days and daily average
  const dateMap = {};
  for (const s of data.sessions) {
    dateMap[s.date] = (dateMap[s.date] || 0) + sessionSeconds(s);
  }
  const activeDays = Object.keys(dateMap).length;
  const totalAllSeconds = data.sessions.reduce((acc, s) => acc + sessionSeconds(s), 0);
  const avgSecs = activeDays > 0 ? Math.round(totalAllSeconds / activeDays) : 0;
  $('analytics-daily-avg').textContent = formatDuration(avgSecs, true);

  // Most productive day of the week
  const dayTotals = [0, 0, 0, 0, 0, 0, 0]; // Sun to Sat
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const s of data.sessions) {
    if (s.startedAt) {
      const d = new Date(s.startedAt).getDay();
      dayTotals[d] += sessionSeconds(s);
    }
  }
  let maxDayIdx = -1;
  let maxDaySecs = 0;
  dayTotals.forEach((secs, i) => {
    if (secs > maxDaySecs) {
      maxDaySecs = secs;
      maxDayIdx = i;
    }
  });
  if (maxDayIdx !== -1 && maxDaySecs > 0) {
    $('analytics-best-day').textContent = dayNames[maxDayIdx];
    $('analytics-best-day-detail').textContent = `${formatDuration(maxDaySecs, true)} total studied`;
  } else {
    $('analytics-best-day').textContent = 'None yet';
    $('analytics-best-day-detail').textContent = 'Record sessions to find out';
  }

  // Daily Goal Hit Rate
  const goalSecs = (Number(data.goalMinutes) || 240) * 60;
  let goalsMetCount = 0;
  Object.values(dateMap).forEach((secs) => {
    if (secs >= goalSecs) goalsMetCount++;
  });
  const ratePct = activeDays > 0 ? Math.round((goalsMetCount / activeDays) * 100) : 0;
  $('analytics-goal-rate').textContent = `${ratePct}%`;
  $('analytics-goals-met-caption').textContent = `${goalsMetCount} of ${activeDays} active day${activeDays === 1 ? '' : 's'} met goal`;

  // 12-Week (84-day) Calendar Heatmap
  renderHeatmap(dateMap);

  // Subject breakdown distribution
  renderSubjectBreakdown();

  // Last 14 days duration trend chart
  renderTrendChart(dateMap);
}

function renderHeatmap(dateMap) {
  const grid = $('heatmap-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const today = new Date();
  const daysTotal = 84; // 12 weeks
  let total84Secs = 0;

  // Compute 84 days list ending today
  for (let i = daysTotal - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const k = dateKey(d);
    const secs = dateMap[k] || 0;
    total84Secs += secs;

    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';

    // Intensity levels: 0m, 1-30m, 30m-60m, 1h-2h, 2h+
    let level = 'level-0';
    if (secs >= 7200) level = 'level-4';
    else if (secs >= 3600) level = 'level-3';
    else if (secs >= 1800) level = 'level-2';
    else if (secs > 0) level = 'level-1';

    cell.classList.add(level);
    const label = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}: ${secs > 0 ? formatDuration(secs, true) : 'No study activity'}`;
    cell.setAttribute('title', label);

    cell.addEventListener('mouseenter', () => {
      $('heatmap-inspector').textContent = `📅 ${label}`;
    });
    cell.addEventListener('click', () => {
      $('heatmap-inspector').textContent = `📅 ${label}`;
    });

    grid.appendChild(cell);
  }

  $('heatmap-total-label').textContent = `${formatDuration(total84Secs, true)} studied in last 84 days`;
}

function renderSubjectBreakdown() {
  const container = $('analytics-subject-bars');
  if (!container) return;
  container.innerHTML = '';

  const subjectMap = {};
  let totalSecs = 0;
  for (const s of data.sessions) {
    const sub = s.subject || 'General';
    const secs = sessionSeconds(s);
    subjectMap[sub] = (subjectMap[sub] || 0) + secs;
    totalSecs += secs;
  }

  if (totalSecs === 0) {
    container.innerHTML = '<p class="hint">No study sessions recorded yet.</p>';
    return;
  }

  Object.entries(subjectMap)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sub, secs]) => {
      const pct = Math.round((secs / totalSecs) * 100);
      const color = getSubjectColor(sub);

      const item = document.createElement('div');
      item.className = 'subject-bar-item';
      item.innerHTML = `
        <div class="subject-bar-header">
          <span style="color:${color}">● ${sub}</span>
          <span style="font-family:var(--font-mono)">${formatDuration(secs, true)} (${pct}%)</span>
        </div>
        <div class="subject-bar-track">
          <div class="subject-bar-fill" style="width:${pct}%; background:${color}"></div>
        </div>`;
      container.appendChild(item);
    });
}

function renderTrendChart(dateMap) {
  const wrap = $('analytics-trend-chart');
  if (!wrap) return;
  wrap.innerHTML = '';

  const today = new Date();
  const days = [];
  let maxSecs = 3600; // default 1h scale minimum

  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const k = dateKey(d);
    const secs = dateMap[k] || 0;
    if (secs > maxSecs) maxSecs = secs;
    days.push({ date: d, key: k, secs });
  }

  days.forEach((item) => {
    const heightPct = Math.max(4, Math.round((item.secs / maxSecs) * 100));
    const dayLabel = item.date.toLocaleDateString(undefined, { weekday: 'narrow' });

    const col = document.createElement('div');
    col.className = 'trend-bar-col';
    col.setAttribute('title', `${item.key}: ${formatDuration(item.secs, true)}`);
    col.innerHTML = `
      <div class="trend-bar-pillar" style="height:${heightPct}%"></div>
      <span class="trend-bar-label">${dayLabel}</span>`;
    wrap.appendChild(col);
  });
}

// ----------------------------------------------------
// EXAM & STUDY PLANNER (Feature 3)
// ----------------------------------------------------
let currentExamFilter = 'upcoming';

function renderPlanner() {
  if (!data) return;
  renderExamsList();
  renderTasksList();
}

function renderExamsList() {
  const list = $('exam-list');
  if (!list) return;
  list.innerHTML = '';

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const exams = (data.exams || []).map((e) => {
    const examDate = new Date(e.date);
    examDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return { ...e, diffDays };
  });

  const filtered = exams.filter((e) => (currentExamFilter === 'upcoming' ? e.diffDays >= 0 : e.diffDays < 0));
  filtered.sort((a, b) => (currentExamFilter === 'upcoming' ? a.diffDays - b.diffDays : b.diffDays - a.diffDays));

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state">
        <strong>No ${currentExamFilter} exams</strong>
        <p>Click "＋ Add Exam" above to add target test dates and track countdowns.</p>
      </div>`;
    return;
  }

  for (const e of filtered) {
    const card = document.createElement('div');
    card.className = 'exam-card';

    let badgeClass = 'plenty';
    let badgeText = `${e.diffDays} days left`;
    if (e.diffDays < 0) {
      badgeClass = 'past';
      badgeText = `${Math.abs(e.diffDays)}d ago`;
    } else if (e.diffDays === 0) {
      badgeClass = 'urgent';
      badgeText = 'TODAY!';
    } else if (e.diffDays <= 7) {
      badgeClass = 'urgent';
      badgeText = `${e.diffDays}d left`;
    } else if (e.diffDays <= 21) {
      badgeClass = 'soon';
      badgeText = `${e.diffDays}d left`;
    }

    card.innerHTML = `
      <div class="exam-main">
        <div class="exam-title">${escapeHTML(e.title)}</div>
        <div class="exam-sub">
          <span style="color:${getSubjectColor(e.subject)}">● ${escapeHTML(e.subject || 'General')}</span>
          <span>📅 ${new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          ${e.notes ? `<span>· ${escapeHTML(e.notes)}</span>` : ''}
        </div>
      </div>
      <div class="days-badge ${badgeClass}">${badgeText}</div>
      <button class="history-del-btn" title="Delete Exam">✕</button>`;

    card.querySelector('.history-del-btn').onclick = async (ev) => {
      ev.stopPropagation();
      if (confirm(`Delete exam "${e.title}"?`)) {
        data.exams = data.exams.filter((x) => x.id !== e.id);
        await save();
        renderPlanner();
        showToast('Exam deleted');
      }
    };

    list.appendChild(card);
  }
}

function renderTasksList() {
  const list = $('task-list');
  if (!list) return;
  list.innerHTML = '';

  const statusFilter = $('task-filter-status').value;
  const prioFilter = $('task-filter-priority').value;

  let tasks = [...(data.tasks || [])];

  if (statusFilter === 'active') tasks = tasks.filter((t) => !t.completed);
  if (statusFilter === 'completed') tasks = tasks.filter((t) => t.completed);
  if (prioFilter !== 'all') tasks = tasks.filter((t) => t.priority === prioFilter);

  // Sort: Incomplete first, then by deadline
  tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
    return 0;
  });

  if (!tasks.length) {
    list.innerHTML = `
      <div class="empty-state">
        <strong>No tasks found</strong>
        <p>Add a task to organize topics, exercises, or revision goals.</p>
      </div>`;
    return;
  }

  for (const t of tasks) {
    const card = document.createElement('div');
    card.className = `task-card ${t.completed ? 'completed' : ''}`;
    const prio = (t.priority || 'medium').toLowerCase();

    card.innerHTML = `
      <div class="task-check ${t.completed ? 'checked' : ''}">${t.completed ? '✓' : ''}</div>
      <div class="task-info">
        <div class="task-title">${escapeHTML(t.title)}</div>
        <div class="task-meta">
          <span style="color:${getSubjectColor(t.subject)}">● ${escapeHTML(t.subject || 'General')}</span>
          <span class="priority-tag ${prio}">${prio}</span>
          ${t.deadline ? `<span>⏰ ${new Date(t.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>` : ''}
        </div>
      </div>
      <button class="history-del-btn" title="Delete Task">✕</button>`;

    card.querySelector('.task-check').onclick = async () => {
      t.completed = !t.completed;
      await save();
      renderTasksList();
      checkAchievements();
    };

    card.querySelector('.history-del-btn').onclick = async (ev) => {
      ev.stopPropagation();
      data.tasks = data.tasks.filter((x) => x.id !== t.id);
      await save();
      renderTasksList();
      showToast('Task removed');
    };

    list.appendChild(card);
  }
}

// ----------------------------------------------------
// STUDY NOTES (Feature 6)
// ----------------------------------------------------
let autosaveTimer = null;

function renderNotes() {
  if (!data) return;
  const list = $('notes-list');
  if (!list) return;
  list.innerHTML = '';

  const q = ($('notes-search-input').value || '').trim().toLowerCase();
  let notes = [...(data.notes || [])];

  if (q) {
    notes = notes.filter((n) => (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q));
  }
  notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (!notes.length) {
    list.innerHTML = '<p class="hint" style="padding:14px; text-align:center;">No notes found</p>';
  } else {
    for (const n of notes) {
      const item = document.createElement('div');
      item.className = `note-item ${n.id === selectedNoteId ? 'active' : ''}`;
      item.innerHTML = `
        <div class="note-item-title">${escapeHTML(n.title || 'Untitled Note')}</div>
        <div class="note-item-snippet">${escapeHTML((n.content || '').slice(0, 50) || 'Empty note...')}</div>`;
      item.onclick = () => selectNote(n.id);
      list.appendChild(item);
    }
  }

  // Populate exam options in note editor
  const examSel = $('note-exam-select');
  if (examSel) {
    examSel.innerHTML = '<option value="">None</option>';
    (data.exams || []).forEach((e) => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.title;
      examSel.appendChild(opt);
    });
  }

  // If a note is selected, load into editor
  const currentNote = (data.notes || []).find((n) => n.id === selectedNoteId);
  if (currentNote) {
    $('notes-empty-select').style.display = 'none';
    $('note-editor-inner').style.display = 'flex';
    $('note-title-input').value = currentNote.title || '';
    $('note-content-input').value = currentNote.content || '';
    $('note-subject-select').value = currentNote.subject || 'General';
    $('note-exam-select').value = currentNote.examId || '';
    $('note-updated-date').textContent = `Updated: ${new Date(currentNote.updatedAt || Date.now()).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } else {
    $('notes-empty-select').style.display = 'flex';
    $('note-editor-inner').style.display = 'none';
  }
}

function selectNote(id) {
  selectedNoteId = id;
  renderNotes();
}

async function createNewNote() {
  const newNote = {
    id: `note_${Date.now()}`,
    title: 'Untitled Focus Note',
    content: '',
    subject: $('subject-select') ? $('subject-select').value : 'General',
    examId: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  if (!Array.isArray(data.notes)) data.notes = [];
  data.notes.unshift(newNote);
  selectedNoteId = newNote.id;
  await save();
  renderNotes();
  $('note-title-input').focus();
  showToast('New note created');
}

function triggerNoteAutosave() {
  if (!selectedNoteId) return;
  const n = (data.notes || []).find((x) => x.id === selectedNoteId);
  if (!n) return;

  $('note-save-status').textContent = 'Saving...';
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    n.title = $('note-title-input').value;
    n.content = $('note-content-input').value;
    n.subject = $('note-subject-select').value;
    n.examId = $('note-exam-select').value;
    n.updatedAt = Date.now();
    await save();
    $('note-save-status').textContent = 'Saved ✓';
    $('note-updated-date').textContent = `Updated: ${new Date(n.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    // Refresh sidebar snippets
    const list = $('notes-list');
    if (list) {
      const activeEl = list.querySelector('.note-item.active');
      if (activeEl) {
        activeEl.querySelector('.note-item-title').textContent = n.title || 'Untitled Note';
        activeEl.querySelector('.note-item-snippet').textContent = (n.content || '').slice(0, 50) || 'Empty note...';
      }
    }
  }, 400);
}

// ----------------------------------------------------
// STREAKS & ACHIEVEMENTS (Feature 5)
// ----------------------------------------------------
const ACHIEVEMENTS_DEF = [
  { id: 'first_session', title: 'First Step', desc: 'Complete your first study session', icon: '🚀' },
  { id: 'goal_met', title: 'Goal Crusher', desc: 'Reach your daily study goal for the first time', icon: '🎯' },
  { id: 'streak_3', title: 'Focus Momentum', desc: 'Maintain a 3-day consecutive study streak', icon: '🔥' },
  { id: 'streak_7', title: 'Week Warrior', desc: 'Hit a 7-day consecutive study streak', icon: '⚡' },
  { id: 'streak_30', title: 'Iron Focus', desc: '30-day streak of consistent study', icon: '🏆' },
  { id: 'pomo_5', title: 'Pomodoro Pro', desc: 'Complete 5 Pomodoro focus sessions', icon: '🍅' },
  { id: 'hours_10', title: 'Double Digit', desc: 'Accumulate 10 total hours of deep study', icon: '⏳' },
  { id: 'hours_50', title: 'Master of Focus', desc: 'Achieve 50 total hours of mastery', icon: '👑' }
];

function calculateStreaks() {
  const thresholdMins = (data.settings && Number(data.settings.streakThresholdMinutes)) || 15;
  const thresholdSecs = thresholdMins * 60;

  const dateMap = {};
  for (const s of data.sessions) {
    dateMap[s.date] = (dateMap[s.date] || 0) + sessionSeconds(s);
  }

  // Check qualifying dates sorted chronologically
  const sortedDates = Object.keys(dateMap).sort();
  const qualifyingSet = new Set();
  sortedDates.forEach((d) => {
    if (dateMap[d] >= thresholdSecs) qualifyingSet.add(d);
  });

  const todayStr = dateKey();
  const todayQualified = qualifyingSet.has(todayStr);

  // Compute current streak
  let currentStreak = 0;
  let checkDate = new Date();
  if (!todayQualified) {
    // If today hasn't met the threshold yet, streak continues from yesterday
    checkDate.setDate(checkDate.getDate() - 1);
  }

  while (qualifyingSet.has(dateKey(checkDate))) {
    currentStreak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  // Compute longest streak
  let longestStreak = 0;
  let runningCount = 0;
  if (sortedDates.length > 0) {
    let prev = new Date(sortedDates[0]);
    sortedDates.forEach((dStr) => {
      if (qualifyingSet.has(dStr)) {
        const cur = new Date(dStr);
        const diff = Math.round((cur - prev) / (1000 * 60 * 60 * 24));
        if (diff === 1) {
          runningCount++;
        } else if (diff === 0) {
          runningCount = Math.max(1, runningCount);
        } else {
          runningCount = 1;
        }
        prev = cur;
        if (runningCount > longestStreak) longestStreak = runningCount;
      }
    });
  }

  return { currentStreak, longestStreak: Math.max(longestStreak, currentStreak), todayQualified };
}

function checkAchievements() {
  if (!data) return;
  const { currentStreak, todayQualified } = calculateStreaks();
  const totalSecs = data.sessions.reduce((acc, s) => acc + sessionSeconds(s), 0);
  const pomoCount = (data.pomodoro && data.pomodoro.completedSessions) || 0;
  const unlocked = new Set((data.achievements || []).map((a) => a.id));

  let newlyUnlocked = null;

  function award(id) {
    if (!unlocked.has(id)) {
      const def = ACHIEVEMENTS_DEF.find((a) => a.id === id);
      if (def) {
        data.achievements.push({ id, title: def.title, unlockedAt: Date.now() });
        unlocked.add(id);
        newlyUnlocked = def;
      }
    }
  }

  if (data.sessions.length >= 1) award('first_session');
  if (todayQualified) award('goal_met');
  if (currentStreak >= 3) award('streak_3');
  if (currentStreak >= 7) award('streak_7');
  if (currentStreak >= 30) award('streak_30');
  if (pomoCount >= 5) award('pomo_5');
  if (totalSecs >= 36000) award('hours_10'); // 10h
  if (totalSecs >= 180000) award('hours_50'); // 50h

  if (newlyUnlocked) {
    save();
    playChime();
    showToast(`🏆 Achievement Unlocked: ${newlyUnlocked.title}!`);
    notifyUser(`Achievement Unlocked! ${newlyUnlocked.icon}`, `${newlyUnlocked.title}: ${newlyUnlocked.desc}`);
  }
}

function renderAchievements() {
  if (!data) return;
  const { currentStreak, longestStreak, todayQualified } = calculateStreaks();

  $('streak-current-count').textContent = `${currentStreak} Day${currentStreak === 1 ? '' : 's'}`;
  $('streak-longest-count').textContent = `${longestStreak} Day${longestStreak === 1 ? '' : 's'}`;
  $('streak-today-status').textContent = todayQualified ? 'Met ✓' : 'In Progress';
  $('streak-today-caption').textContent = todayQualified ? 'Today qualified for your streak!' : `Study ${data.settings.streakThresholdMinutes || 15}m today to keep streak active`;

  const unlockedMap = {};
  (data.achievements || []).forEach((a) => {
    unlockedMap[a.id] = a.unlockedAt;
  });

  const grid = $('achievements-grid');
  if (grid) {
    grid.innerHTML = '';
    ACHIEVEMENTS_DEF.forEach((def) => {
      const isUnlocked = Boolean(unlockedMap[def.id]);
      const card = document.createElement('div');
      card.className = `achievement-badge-card ${isUnlocked ? 'unlocked' : ''}`;
      card.innerHTML = `
        <div class="achievement-icon-wrap">${def.icon}</div>
        <div class="achievement-name">${def.title}</div>
        <div class="achievement-desc">${def.desc}</div>
        ${isUnlocked ? `<div class="achievement-time-tag">Unlocked · ${new Date(unlockedMap[def.id]).toLocaleDateString()}</div>` : '<div class="stat-foot">Locked</div>'}`;
      grid.appendChild(card);
    });
  }

  const unlockedCount = Object.keys(unlockedMap).length;
  $('achievements-unlocked-count').textContent = `${unlockedCount} / ${ACHIEVEMENTS_DEF.length} Unlocked`;
}

// ----------------------------------------------------
// SETTINGS (View 7)
// ----------------------------------------------------
function renderSettings() {
  if (!data) return;
  const pSettings = data.pomodoro.settings || {};
  $('setting-focus-min').value = pSettings.focusDuration || 25;
  $('setting-short-min').value = pSettings.shortBreakDuration || 5;
  $('setting-long-min').value = pSettings.longBreakDuration || 15;
  $('setting-long-interval').value = pSettings.longBreakInterval || 4;

  const appSettings = data.settings || {};
  $('setting-streak-min').value = appSettings.streakThresholdMinutes || 15;
  $('setting-sound-toggle').checked = appSettings.soundEnabled !== false;
  $('setting-notif-toggle').checked = appSettings.notificationsEnabled !== false;
}

async function savePomodoroSettings() {
  const f = Math.max(1, parseInt($('setting-focus-min').value, 10) || 25);
  const s = Math.max(1, parseInt($('setting-short-min').value, 10) || 5);
  const l = Math.max(1, parseInt($('setting-long-min').value, 10) || 15);
  const int = Math.max(2, parseInt($('setting-long-interval').value, 10) || 4);

  data.pomodoro.settings.focusDuration = f;
  data.pomodoro.settings.shortBreakDuration = s;
  data.pomodoro.settings.longBreakDuration = l;
  data.pomodoro.settings.longBreakInterval = int;

  // Adjust active Pomodoro duration if currently not running
  if (!data.pomodoro.running) {
    data.pomodoro.targetDuration = getPomodoroTarget(data.pomodoro.mode);
  }

  await save();
  showToast('Pomodoro settings saved');
  renderPomodoro();
}

function exportDataBackup() {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `study-tracker-backup-${dateKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup JSON downloaded');
}

// ----------------------------------------------------
// MODAL DIALOG (Exams & Tasks)
// ----------------------------------------------------
function openAddExamModal() {
  modalMode = 'exam';
  $('modal-title').textContent = 'Add Upcoming Exam';
  $('modal-body').innerHTML = `
    <div class="form-group">
      <label>Exam Title *</label>
      <input type="text" id="m-exam-title" placeholder="e.g. Biology Paper 2 Final" required>
    </div>
    <div class="form-group">
      <label>Subject</label>
      <select id="m-exam-subject">
        <option value="General">General</option>
        <option value="Maths">Maths</option>
        <option value="Science">Science</option>
        <option value="Coding">Coding</option>
        <option value="English">English</option>
        <option value="Reading">Reading</option>
      </select>
    </div>
    <div class="form-group">
      <label>Exam Date *</label>
      <input type="date" id="m-exam-date" required>
    </div>
    <div class="form-group">
      <label>Notes / Target Goal</label>
      <input type="text" id="m-exam-notes" placeholder="e.g. Target Score 90%, Chapters 4-9">
    </div>`;
  $('planner-modal').style.display = 'flex';
}

function openAddTaskModal() {
  modalMode = 'task';
  $('modal-title').textContent = 'Add Study Task';
  $('modal-body').innerHTML = `
    <div class="form-group">
      <label>Task Title *</label>
      <input type="text" id="m-task-title" placeholder="e.g. Complete Organic Chemistry practice set" required>
    </div>
    <div class="form-group">
      <label>Subject</label>
      <select id="m-task-subject">
        <option value="General">General</option>
        <option value="Maths">Maths</option>
        <option value="Science">Science</option>
        <option value="Coding">Coding</option>
        <option value="English">English</option>
        <option value="Reading">Reading</option>
      </select>
    </div>
    <div class="form-group">
      <label>Priority</label>
      <select id="m-task-priority">
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="low">Low</option>
      </select>
    </div>
    <div class="form-group">
      <label>Deadline Date</label>
      <input type="date" id="m-task-date">
    </div>`;
  $('planner-modal').style.display = 'flex';
}

function closeModal() {
  $('planner-modal').style.display = 'none';
}

async function handleModalSave() {
  if (modalMode === 'exam') {
    const title = ($('m-exam-title').value || '').trim();
    const date = $('m-exam-date').value;
    const subject = $('m-exam-subject').value;
    const notes = ($('m-exam-notes').value || '').trim();
    if (!title || !date) {
      showToast('Title and exam date are required');
      return;
    }
    data.exams.push({
      id: `exam_${Date.now()}`,
      title,
      date,
      subject,
      notes,
      createdAt: Date.now()
    });
    await save();
    closeModal();
    renderPlanner();
    showToast('Exam added');
  } else if (modalMode === 'task') {
    const title = ($('m-task-title').value || '').trim();
    const subject = $('m-task-subject').value;
    const priority = $('m-task-priority').value;
    const deadline = $('m-task-date').value;
    if (!title) {
      showToast('Task title is required');
      return;
    }
    data.tasks.push({
      id: `task_${Date.now()}`,
      title,
      subject,
      priority,
      deadline,
      completed: false,
      createdAt: Date.now()
    });
    await save();
    closeModal();
    renderPlanner();
    showToast('Task added');
  }
}

// Escape helper for safe XSS-free DOM interpolation
function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ----------------------------------------------------
// MAIN TICK LOOP (Reliable 250ms update)
// ----------------------------------------------------
function tick() {
  checkPomodoroAutoFinish();
  if (activeView === 'dashboard') {
    renderDashboard();
  } else if (activeView === 'pomodoro') {
    renderPomodoro();
  }
}

function startTicker() {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(tick, 250);
}

// ----------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------
async function init() {
  data = await window.studyAPI.loadData();

  // Navigation tab listeners
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView(btn.getAttribute('data-view'));
    });
  });

  // Mini timer toggle button
  $('open-mini-timer-btn').addEventListener('click', () => {
    window.studyAPI.openMiniTimer();
  });

  // Manual timer buttons
  $('start-btn').addEventListener('click', startManual);
  $('pause-btn').addEventListener('click', pauseManual);
  $('finish-btn').addEventListener('click', finishManual);
  $('save-goal-btn').addEventListener('click', saveGoal);
  $('add-subject-btn').addEventListener('click', async () => {
    const name = prompt('Enter a subject name:');
    if (!name || !name.trim()) return;
    const clean = name.trim().slice(0, 40);
    const select = $('subject-select');
    const exists = [...select.options].some((o) => o.value.toLowerCase() === clean.toLowerCase());
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = clean;
      opt.textContent = clean;
      select.append(opt);

      // Add to pomo select too
      if ($('pomo-subject-select')) {
        const pOpt = document.createElement('option');
        pOpt.value = clean;
        pOpt.textContent = clean;
        $('pomo-subject-select').append(pOpt);
      }
    }
    select.value = clean;
    syncControls();
    showToast(`Subject ready: ${clean}`);
  });

  $('goal-hours').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveGoal(); });
  $('goal-mins').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveGoal(); });

  // Pomodoro controls
  $('pomo-mode-focus').addEventListener('click', () => switchPomodoroMode('focus'));
  $('pomo-mode-short').addEventListener('click', () => switchPomodoroMode('shortBreak'));
  $('pomo-mode-long').addEventListener('click', () => switchPomodoroMode('longBreak'));
  $('pomo-start-btn').addEventListener('click', togglePomodoro);
  $('pomo-reset-btn').addEventListener('click', resetPomodoro);
  $('pomo-skip-btn').addEventListener('click', finishOrSkipPomodoro);

  document.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.preset-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const min = parseInt(chip.getAttribute('data-min'), 10) || 25;
      data.pomodoro.settings.focusDuration = min;
      if (data.pomodoro.mode === 'focus' && !data.pomodoro.running) {
        data.pomodoro.targetDuration = min * 60;
      }
      save();
      renderPomodoro();
      showToast(`Preset set to ${min}m`);
    });
  });

  // Planner filters & modals
  $('exam-tab-upcoming').addEventListener('click', () => {
    currentExamFilter = 'upcoming';
    $('exam-tab-upcoming').classList.add('active');
    $('exam-tab-past').classList.remove('active');
    renderExamsList();
  });
  $('exam-tab-past').addEventListener('click', () => {
    currentExamFilter = 'past';
    $('exam-tab-past').classList.add('active');
    $('exam-tab-upcoming').classList.remove('active');
    renderExamsList();
  });

  $('task-filter-status').addEventListener('change', renderTasksList);
  $('task-filter-priority').addEventListener('change', renderTasksList);

  $('add-exam-btn').addEventListener('click', openAddExamModal);
  $('add-task-btn').addEventListener('click', openAddTaskModal);
  $('modal-close-btn').addEventListener('click', closeModal);
  $('modal-cancel-btn').addEventListener('click', closeModal);
  $('modal-confirm-btn').addEventListener('click', handleModalSave);

  // Notes controls
  $('new-note-btn').addEventListener('click', createNewNote);
  $('notes-search-input').addEventListener('input', renderNotes);
  $('note-title-input').addEventListener('input', triggerNoteAutosave);
  $('note-content-input').addEventListener('input', triggerNoteAutosave);
  $('note-subject-select').addEventListener('change', triggerNoteAutosave);
  $('note-exam-select').addEventListener('change', triggerNoteAutosave);
  $('note-delete-btn').addEventListener('click', async () => {
    if (!selectedNoteId) return;
    if (confirm('Permanently delete this note?')) {
      data.notes = (data.notes || []).filter((n) => n.id !== selectedNoteId);
      selectedNoteId = null;
      await save();
      renderNotes();
      showToast('Note deleted');
    }
  });

  // Settings buttons
  $('save-pomo-settings-btn').addEventListener('click', savePomodoroSettings);
  $('setting-streak-min').addEventListener('change', (e) => {
    data.settings.streakThresholdMinutes = parseInt(e.target.value, 10) || 15;
    save();
  });
  $('setting-sound-toggle').addEventListener('change', (e) => {
    data.settings.soundEnabled = e.target.checked;
    save();
  });
  $('setting-notif-toggle').addEventListener('change', (e) => {
    data.settings.notificationsEnabled = e.target.checked;
    save();
  });
  $('export-data-btn').addEventListener('click', exportDataBackup);

  // Inter-window IPC sync: listen to mini timer actions
  window.studyAPI.onTimerBroadcast((payload) => {
    if (payload && payload.action) {
      if (payload.action === 'toggle') {
        if (data.activeTimerType === 'pomodoro') togglePomodoro();
        else {
          if (data.timer.running) pauseManual();
          else startManual();
        }
      } else if (payload.action === 'finish') {
        if (data.activeTimerType === 'pomodoro') finishOrSkipPomodoro();
        else finishManual();
      } else if (payload.action === 'reset') {
        if (data.activeTimerType === 'pomodoro') resetPomodoro();
      }
    }
  });

  // On remote data update (e.g. saved from mini window)
  window.studyAPI.onDataUpdated((updated) => {
    data = updated;
    syncGoalInputs(false);
  });

  // Initial render
  syncGoalInputs(true);
  renderDashboard();
  checkAchievements();
  startTicker();
}

init().catch((err) => {
  console.error('Study Time Tracker init error:', err);
  document.body.innerHTML = '<p style="padding:30px;color:#fff">Could not load study data. Try closing and reopening the app.</p>';
});
