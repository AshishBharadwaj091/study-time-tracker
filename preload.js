const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studyAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data)
});
