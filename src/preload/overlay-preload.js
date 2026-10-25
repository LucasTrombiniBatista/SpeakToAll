const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wp', {
  isMock: false,
  onCommand: (cb) => ipcRenderer.on('overlay:command', (_e, cmd) => cb(cmd)),
  sendAudio: (wav) => ipcRenderer.send('overlay:audio', wav),
  hide: () => ipcRenderer.send('overlay:hide'),
});
