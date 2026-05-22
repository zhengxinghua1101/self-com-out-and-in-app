const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startVirtualSerial: (baudRate) => ipcRenderer.invoke('start-virtual-serial', baudRate),
  stopVirtualSerial: () => ipcRenderer.invoke('stop-virtual-serial'),
  onDataReceived: (callback) => ipcRenderer.on('data-received', (event, data) => callback(data)),
  onSerialError: (callback) => ipcRenderer.on('serial-error', (event, msg) => callback(msg))
});
