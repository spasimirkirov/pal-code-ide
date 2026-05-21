import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('palRuntime', {
    getWorkspaceRoot: () => ipcRenderer.invoke('runtime:getWorkspaceRoot'),
    setWorkspaceRoot: (payload) => ipcRenderer.invoke('runtime:setWorkspaceRoot', payload),
    bootstrapRuntime: () => ipcRenderer.invoke('runtime:bootstrap'),
    cancelBootstrapRuntime: () => ipcRenderer.invoke('runtime:cancelBootstrap'),
    getHardwareMetrics: () => ipcRenderer.invoke('runtime:getHardwareMetrics'),
    listProjectTree: () => ipcRenderer.invoke('project:listTree'),
    readProjectFile: (payload) => ipcRenderer.invoke('project:readFile', payload),
    gitStatus: () => ipcRenderer.invoke('git:status'),
    gitCommit: (payload) => ipcRenderer.invoke('git:commit', payload),
    databaseConnect: (payload) => ipcRenderer.invoke('database-connect', payload),
    databaseGetTables: () => ipcRenderer.invoke('database-get-tables'),
    dbFetchRows: (payload) => ipcRenderer.invoke('db-fetch-rows', payload),
    dbDeleteRow: (payload) => ipcRenderer.invoke('db-delete-row', payload),
    dbInsertRow: (payload) => ipcRenderer.invoke('db-insert-row', payload),
    minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
    closeWindow: () => ipcRenderer.invoke('window:close'),
    getWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onDownloadProgress: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('runtime:downloadProgress', handler);
        return () => ipcRenderer.removeListener('runtime:downloadProgress', handler);
    },
    onHardwareMetrics: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('runtime:hardwareMetrics', handler);
        return () => ipcRenderer.removeListener('runtime:hardwareMetrics', handler);
    },
    onWindowMaximizedChanged: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('window:maximizedChanged', handler);
        return () => ipcRenderer.removeListener('window:maximizedChanged', handler);
    },
    llamaStatus: () => ipcRenderer.invoke('llama:status'),
    startLlama: () => ipcRenderer.invoke('llama:start'),
    stopLlama: () => ipcRenderer.invoke('llama:stop'),
    terminalExecute: (payload) => ipcRenderer.invoke('mcp:terminalExecute', payload),
    duckduckgoSearch: (payload) => ipcRenderer.invoke('mcp:duckduckgoSearch', payload),
});
