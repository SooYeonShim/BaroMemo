const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  exportJson: (data) => ipcRenderer.invoke('export-json', data),
  saveImage: (base64, ext) => ipcRenderer.invoke('save-image', base64, ext),
  copyImage: (src) => ipcRenderer.send('copy-image', src),
  copyMixed: (html, text, src) => ipcRenderer.send('copy-mixed', html, text, src),

  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openExplorer: () => ipcRenderer.send('open-explorer'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),
  changeDataPath: () => ipcRenderer.invoke('change-data-path'),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveLastMemo: (id) => ipcRenderer.send('save-last-memo', id),
  cleanupImages: (memos) => ipcRenderer.invoke('cleanup-images', memos),
  openImageViewer: (src, theme, width, height) => ipcRenderer.send('open-image-viewer', src, theme, width, height),
  onSetImage: (cb) => ipcRenderer.on('set-image', (_, src, theme) => cb(src, theme)),
  onAlwaysOnTopChanged: (cb) => ipcRenderer.on('always-on-top-changed', (_, val) => cb(val)),
  onMaximizedChanged: (cb) => ipcRenderer.on('maximized-changed', (_, val) => cb(val)),
  onNewMemo: (cb) => ipcRenderer.on('new-memo', (_, wasVisible) => cb(wasVisible)),
});
