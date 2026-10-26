const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const dataPath = () => path.join(app.getPath('userData'), 'study-data.json');

function defaultData() {
  return { goalMinutes: 240, sessions: [], timer: { running: false, subject: 'General', startedAt: null, elapsedBeforeStart: 0 } };
}
function readData() {
  try {
    const data = JSON.parse(fs.readFileSync(dataPath(), 'utf8'));
    return { ...defaultData(), ...data, timer: { ...defaultData().timer, ...(data.timer || {}) } };
  } catch {
    return defaultData();
  }
}
function writeData(data) {
  fs.mkdirSync(path.dirname(dataPath()), { recursive: true });
  fs.writeFileSync(dataPath(), JSON.stringify(data, null, 2), 'utf8');
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040, height: 780, minWidth: 780, minHeight: 640,
    backgroundColor: '#0b1020',
    title: 'Study Time Tracker',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile('index.html');
}
app.whenReady().then(() => {
  ipcMain.handle('data:load', () => readData());
  ipcMain.handle('data:save', (_event, data) => { writeData(data); return { ok: true }; });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
