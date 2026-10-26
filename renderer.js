const $ = (id) => document.getElementById(id);
let data;
let ticker = null;
let toastTimer = null;

const pad = (n) => String(n).padStart(2, '0');
function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}
function formatClock(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds%3600/60))}:${pad(seconds%60)}`;
}
function formatDuration(seconds, alwaysShowHours = false) {
  const mins = Math.floor(Math.max(0, seconds)/60);
  const hours = Math.floor(mins/60);
  if (alwaysShowHours || hours > 0) {
    return `${hours}h ${pad(mins%60)}m`;
  }
  return `${mins}m`;
}
function sessionSeconds(session) { return Math.max(0, Number(session.seconds) || 0); }
function currentElapsed() {
  const t = data.timer;
  return (Number(t.elapsedBeforeStart) || 0) + (t.running && t.startedAt ? Math.max(0, (Date.now()-t.startedAt)/1000) : 0);
}
function totals() {
  const today = dateKey();
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (monday.getDay()+6)%7;
  monday.setDate(monday.getDate()-day);
  const weekStart = dateKey(monday);
  let todaySeconds = 0, weekSeconds = 0;
  for (const s of data.sessions) {
    const secs = sessionSeconds(s);
    if (s.date === today) todaySeconds += secs;
    if (s.date >= weekStart && s.date <= today) weekSeconds += secs;
  }
  const live = currentElapsed();
  if (data.timer.running && data.timer.startedAt) {
    if (dateKey(new Date(data.timer.startedAt)) === today) todaySeconds += live;
    if (dateKey(new Date(data.timer.startedAt)) >= weekStart) weekSeconds += live;
  }
  return {todaySeconds, weekSeconds};
}
async function save() { await window.studyAPI.saveData(data); }
function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}
function syncControls() {
  const running = data.timer.running;
  const hasElapsed = currentElapsed() > 0;
  $('start-btn').disabled = running;
  $('pause-btn').disabled = !running;
  $('finish-btn').disabled = !hasElapsed;
  $('subject-select').disabled = running;
  $('timer-status').textContent = running
    ? `You're focusing on ${data.timer.subject}. Keep going!`
    : hasElapsed ? 'Timer paused. Resume whenever you are ready.' : 'Ready when you are. Start a session to begin.';
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
function render() {
  const {todaySeconds, weekSeconds} = totals();
  $('today-label').textContent = new Date().toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
  $('timer-display').textContent = formatClock(currentElapsed());
  $('today-total').textContent = formatDuration(todaySeconds, true);
  $('week-total').textContent = formatDuration(weekSeconds, true);
  const goalSeconds = Math.max(60, Number(data.goalMinutes) || 240) * 60;
  const pct = Math.min(100, Math.round(todaySeconds / goalSeconds * 100));
  $('goal-total').textContent = `${pct}%`;
  $('goal-progress').style.width = `${pct}%`;
  $('goal-caption').textContent = `${formatDuration(todaySeconds, true)} of ${formatDuration(goalSeconds, true)} goal`;
  $('session-count').textContent = `${data.sessions.length} session${data.sessions.length === 1 ? '' : 's'}`;
  renderHistory();
  syncControls();
}
let lastRenderedSessionsKey = null;
function renderHistory() {
  const sessions = data.sessions;
  const key = sessions.length + (sessions.length ? ':' + sessions[sessions.length - 1].endedAt : '');
  if (key === lastRenderedSessionsKey) return;
  lastRenderedSessionsKey = key;
  const list = $('history-list');
  const sorted = [...sessions].sort((a,b) => b.endedAt - a.endedAt).slice(0, 30);
  if (!sorted.length) {
    list.innerHTML = '<div class="empty-state"><span>◷</span><strong>Your first session starts here</strong><p>Complete a study session and it will show up here.</p></div>';
    return;
  }
  list.innerHTML = '';
  for (const s of sorted) {
    const item = document.createElement('div'); item.className = 'history-item';
    const dot = document.createElement('span'); dot.className = 'subject-dot';
    const main = document.createElement('div'); main.className = 'history-main';
    const subject = document.createElement('div'); subject.className = 'history-subject'; subject.textContent = s.subject || 'General';
    const date = document.createElement('div'); date.className = 'history-date';
    date.textContent = new Date(s.endedAt).toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
    const duration = document.createElement('div'); duration.className = 'history-duration'; duration.textContent = formatDuration(sessionSeconds(s));
    main.append(subject, date); item.append(dot, main, duration); list.append(item);
  }
}
function tick() { render(); }
function startTicker() { if (ticker) clearInterval(ticker); ticker = setInterval(tick, 250); }
async function start() {
  const alreadyElapsed = currentElapsed();
  const subject = alreadyElapsed > 0 ? (data.timer.subject || 'General') : ($('subject-select').value || 'General');
  data.timer = {running:true, subject, startedAt:Date.now(), elapsedBeforeStart:alreadyElapsed};
  await save(); render(); showToast(alreadyElapsed > 0 ? 'Study session resumed' : 'Study session started'); startTicker();
}
async function pause() {
  data.timer.elapsedBeforeStart = currentElapsed();
  data.timer.running = false; data.timer.startedAt = null;
  await save(); render(); showToast('Timer paused');
}
async function finish() {
  const seconds = Math.floor(currentElapsed());
  if (seconds < 1) { showToast('Study for at least a second before finishing'); return; }
  data.sessions.push({subject:data.timer.subject || 'General', seconds, date:dateKey(), startedAt:Date.now()-seconds*1000, endedAt:Date.now()});
  data.timer = {running:false, subject:$('subject-select').value || 'General', startedAt:null, elapsedBeforeStart:0};
  await save(); render(); showToast(`Session saved · ${formatDuration(seconds)}`);
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
  render();
  showToast(`Daily goal saved: ${formatDuration(total * 60, true)}`);
}
async function addSubject() {
  const name = prompt('Enter a subject name (for example, History):');
  if (!name || !name.trim()) return;
  const clean = name.trim().slice(0, 40);
  const select = $('subject-select');
  const exists = [...select.options].some(o => o.value.toLowerCase() === clean.toLowerCase());
  if (!exists) { const option = document.createElement('option'); option.value = clean; option.textContent = clean; select.append(option); }
  select.value = clean; showToast(`Subject ready: ${clean}`);
}
async function init() {
  data = await window.studyAPI.loadData();
  if (!Array.isArray(data.sessions)) data.sessions = [];
  if (!data.timer) data.timer = {running:false, subject:'General', startedAt:null, elapsedBeforeStart:0};
  // If the app was closed while the timer was running, elapsed time continues from its saved start time.
  if (data.timer.running && !data.timer.startedAt) {
    data.timer.running = false;
  }
  $('subject-select').value = data.timer.subject || 'General';
  $('start-btn').addEventListener('click', start);
  $('pause-btn').addEventListener('click', pause);
  $('finish-btn').addEventListener('click', finish);
  $('save-goal-btn').addEventListener('click', saveGoal);
  $('add-subject-btn').addEventListener('click', addSubject);
  $('goal-hours').addEventListener('keydown', e => { if (e.key === 'Enter') saveGoal(); });
  $('goal-mins').addEventListener('keydown', e => { if (e.key === 'Enter') saveGoal(); });
  syncGoalInputs(true);
  render();
  startTicker();
}
init().catch(err => { console.error(err); document.body.innerHTML = '<p style="padding:30px;color:#fff">Could not load study data. Try closing and reopening the app.</p>'; });
