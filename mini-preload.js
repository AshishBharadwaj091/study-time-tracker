const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  close: () => ipcRenderer.invoke('mini:close'),
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
  broadcastTimer: (payload) => ipcRenderer.send('timer:broadcast', payload)
});
