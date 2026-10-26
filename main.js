const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let miniWindow = null;

const dataPath = () => path.join(app.getPath('userData'), 'study-data.json');
const backupPath = () => path.join(app.getPath('userData'), 'study-data.backup.json');

function defaultData() {
  return {
    version: 2,
    goalMinutes: 240,
    sessions: [],
    timer: {
      running: false,
      subject: 'General',
      startedAt: null,
      elapsedBeforeStart: 0
    },
    pomodoro: {
      mode: 'focus', // 'focus' | 'shortBreak' | 'longBreak'
      running: false,
      startedAt: null,
      targetDuration: 1500, // 25 mins in seconds
      elapsedBeforeStart: 0,
      subject: 'General',
      completedSessions: 0,
      settings: {
        focusDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        longBreakInterval: 4,
        soundEnabled: true,
        notificationsEnabled: true
      }
    },
    activeTimerType: 'manual', // 'manual' | 'pomodoro'
    exams: [],
    tasks: [],
    notes: [],
    achievements: [],
    settings: {
      streakThresholdMinutes: 15,
      soundEnabled: true,
      notificationsEnabled: true
    }
  };
}

function migrateData(raw) {
  const def = defaultData();
  if (!raw || typeof raw !== 'object') return def;

  // Preserve existing goal, sessions, and timer
  const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
  const goalMinutes = Number.isFinite(raw.goalMinutes) && raw.goalMinutes > 0 ? raw.goalMinutes : def.goalMinutes;
  
  const timer = {
    ...def.timer,
    ...(raw.timer || {})
  };
  // If app closed while timer was running, reset running to false but retain elapsed
  if (timer.running && !timer.startedAt) {
    timer.running = false;
  }

  const rawPomo = raw.pomodoro || {};
  const pomodoro = {
    ...def.pomodoro,
    ...rawPomo,
    settings: {
      ...def.pomodoro.settings,
      ...(rawPomo.settings || {})
    }
  };
  if (pomodoro.running && !pomodoro.startedAt) {
    pomodoro.running = false;
  }

  const rawSettings = raw.settings || {};
  const settings = {
    ...def.settings,
    ...rawSettings
  };

  return {
    version: 2,
    goalMinutes,
    sessions,
    timer,
    pomodoro,
    activeTimerType: raw.activeTimerType === 'pomodoro' ? 'pomodoro' : 'manual',
    exams: Array.isArray(raw.exams) ? raw.exams : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    achievements: Array.isArray(raw.achievements) ? raw.achievements : [],
    settings
  };
}

function readData() {
  try {
    if (fs.existsSync(dataPath())) {
      const parsed = JSON.parse(fs.readFileSync(dataPath(), 'utf8'));
      return migrateData(parsed);
    }
  } catch (err) {
    console.error('Failed reading primary data file, trying backup:', err);
    try {
      if (fs.existsSync(backupPath())) {
        const backupParsed = JSON.parse(fs.readFileSync(backupPath(), 'utf8'));
        return migrateData(backupParsed);
      }
    } catch (bErr) {
      console.error('Backup read also failed:', bErr);
    }
  }
  return defaultData();
}

function writeData(data) {
  try {
    const dir = path.dirname(dataPath());
    fs.mkdirSync(dir, { recursive: true });

    // Backup existing file before overwrite
    if (fs.existsSync(dataPath())) {
      try {
        fs.copyFileSync(dataPath(), backupPath());
      } catch (copyErr) {
        console.warn('Backup copy skipped:', copyErr.message);
      }
    }

    const jsonStr = JSON.stringify(data, null, 2);
    fs.writeFileSync(dataPath(), jsonStr, 'utf8');

    // Broadcast update to all active windows
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('data:updated', data);
    }
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.webContents.send('data:updated', data);
    }
    return true;
  } catch (err) {
    console.error('Failed writing study data:', err);
    return false;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 840,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#0c0906',
    title: 'Study Time Tracker — Personal Focus OS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.close();
    }
  });
}

function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.show();
    miniWindow.focus();
    return;
  }

  miniWindow = new BrowserWindow({
    width: 330,
    height: 200,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    backgroundColor: '#0c0906',
    title: 'Mini Focus Timer',
    webPreferences: {
      preload: path.join(__dirname, 'mini-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  miniWindow.loadFile('mini-timer.html');
  miniWindow.on('closed', () => {
    miniWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mini:closed');
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.coadcraft.studytracker');
  }

  ipcMain.handle('data:load', () => readData());
  ipcMain.handle('data:save', (_event, data) => {
    const ok = writeData(data);
    return { ok };
  });

  ipcMain.handle('mini:open', () => {
    createMiniWindow();
    return { ok: true };
  });

  ipcMain.handle('mini:close', () => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.close();
    }
    return { ok: true };
  });

  ipcMain.on('timer:broadcast', (_event, payload) => {
    // Relay timer synchronization between main and mini window
    if (mainWindow && !mainWindow.isDestroyed() && _event.sender !== mainWindow.webContents) {
      mainWindow.webContents.send('timer:broadcast', payload);
    }
    if (miniWindow && !miniWindow.isDestroyed() && _event.sender !== miniWindow.webContents) {
      miniWindow.webContents.send('timer:broadcast', payload);
    }
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
