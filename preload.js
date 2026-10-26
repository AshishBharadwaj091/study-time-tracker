const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studyAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  openMiniTimer: () => ipcRenderer.invoke('mini:open'),
  closeMiniTimer: () => ipcRenderer.invoke('mini:close'),
  onDataUpdated: (callback) => {
    const sub = (_event, data) => callback(data);
    ipcRenderer.on('data:updated', sub);
    return () => ipcRenderer.removeListener('data:updated', sub);
  },
  onTimerBroadcast: (callback) => {
    const sub = (_event, payload) => callback(payload);
    ipcRenderer.on('timer:broadcast', sub);
    return () => ipcRenderer.removeListener('timer:broadcast', sub);
  },
  broadcastTimer: (payload) => ipcRenderer.send('timer:broadcast', payload),
  onMiniClosed: (callback) => {
    const sub = () => callback();
    ipcRenderer.on('mini:closed', sub);
    return () => ipcRenderer.removeListener('mini:closed', sub);
  }
});
