const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('extAPI', {
    getExtensions: () => ipcRenderer.invoke('get-extensions'),
    toggleExtension: (folder, enabled) => ipcRenderer.invoke('toggle-extension', { folder, enabled }),
    openSettings: (id, type) => ipcRenderer.invoke('open-extension-settings', { id, type }),
    openFolder: (folder) => ipcRenderer.invoke('open-extension-folder', folder),
    openExtensionsDir: () => ipcRenderer.invoke('open-extensions-dir'),
    installExtension: (urlOrId) => ipcRenderer.invoke('install-extension', urlOrId),
    restartClient: () => ipcRenderer.invoke('restart-client'),
    getConfig: () => ipcRenderer.invoke('get-config'),
    setConfig: (config) => ipcRenderer.invoke('set-config', config),
    setZoom: (delta) => ipcRenderer.invoke('set-zoom', delta),
    resetZoom: () => ipcRenderer.invoke('reset-zoom'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    applyUpdate: () => ipcRenderer.invoke('apply-update'),
    getVersion: () => ipcRenderer.invoke('get-version'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_, data) => callback(data))
});
