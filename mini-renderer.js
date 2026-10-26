let data = null;
let ticker = null;

const pad = (n) => String(n).padStart(2, '0');
function formatTime(secs) {
  secs = Math.max(0, Math.floor(secs));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${pad(m)}:${pad(s)}`;
}

function updateMiniUI() {
  if (!data) return;
  const isPomodoro = data.activeTimerType === 'pomodoro';
  const badge = document.getElementById('mini-badge');
  const subjectEl = document.getElementById('mini-subject');
  const clockEl = document.getElementById('mini-clock');
  const playBtn = document.getElementById('mini-play-btn');

  if (isPomodoro) {
    const p = data.pomodoro;
    const modeLabel = p.mode === 'focus' ? 'FOCUS' : p.mode === 'shortBreak' ? 'SHORT BREAK' : 'LONG BREAK';
    badge.textContent = modeLabel;
    badge.style.color = p.mode === 'focus' ? '#fed7aa' : '#6ee7b7';
    subjectEl.textContent = p.subject || 'General';

    const elapsed = (Number(p.elapsedBeforeStart) || 0) + (p.running && p.startedAt ? Math.max(0, (Date.now() - p.startedAt) / 1000) : 0);
    const target = Number(p.targetDuration) || 1500;
    const remaining = Math.max(0, target - elapsed);

    clockEl.textContent = formatTime(remaining);
    playBtn.textContent = p.running ? 'Ⅱ Pause' : '▶ Play';
  } else {
    const t = data.timer;
    badge.textContent = 'MANUAL TIMER';
    badge.style.color = '#fed7aa';
    subjectEl.textContent = t.subject || 'General';

    const elapsed = (Number(t.elapsedBeforeStart) || 0) + (t.running && t.startedAt ? Math.max(0, (Date.now() - t.startedAt) / 1000) : 0);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = Math.floor(elapsed % 60);
    clockEl.textContent = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    playBtn.textContent = t.running ? 'Ⅱ Pause' : '▶ Play';
  }
}

async function init() {
  data = await window.miniAPI.loadData();
  updateMiniUI();

  if (ticker) clearInterval(ticker);
  ticker = setInterval(updateMiniUI, 250);

  window.miniAPI.onDataUpdated((updated) => {
    data = updated;
    updateMiniUI();
  });

  window.miniAPI.onTimerBroadcast((payload) => {
    if (payload && payload.data) {
      data = payload.data;
      updateMiniUI();
    }
  });

  document.getElementById('mini-close-btn').addEventListener('click', () => {
    window.miniAPI.close();
  });

  document.getElementById('mini-play-btn').addEventListener('click', () => {
    window.miniAPI.broadcastTimer({ action: 'toggle' });
  });

  document.getElementById('mini-finish-btn').addEventListener('click', () => {
    window.miniAPI.broadcastTimer({ action: 'finish' });
  });

  document.getElementById('mini-reset-btn').addEventListener('click', () => {
    window.miniAPI.broadcastTimer({ action: 'reset' });
  });
}

init().catch(console.error);
