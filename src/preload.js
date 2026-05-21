import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('palRuntime', {
    getWorkspaceRoot: () => ipcRenderer.invoke('runtime:getWorkspaceRoot'),
    setWorkspaceRoot: (payload) => ipcRenderer.invoke('runtime:setWorkspaceRoot', payload),
    bootstrapRuntime: () => ipcRenderer.invoke('runtime:bootstrap'),
    cancelBootstrapRuntime: () => ipcRenderer.invoke('runtime:cancelBootstrap'),
    getHardwareMetrics: () => ipcRenderer.invoke('runtime:getHardwareMetrics'),
    getAiAssistantSettings: () => ipcRenderer.invoke('ai:get-settings'),
    setAiAssistantSettings: (payload) => ipcRenderer.invoke('ai:set-settings', payload),
    checkLocalModels: () => ipcRenderer.invoke('check-local-models'),
    checkLocalLlamaServers: () => ipcRenderer.invoke('check-local-llama-servers'),
    downloadLlamaServerVersion: (payload) => ipcRenderer.invoke('download-llama-server-version', payload),
    lmStudioGetModels: (payload) => ipcRenderer.invoke('lmstudio:get-models', payload),
    getAppearanceSettings: () => ipcRenderer.invoke('settings:getAppearance'),
    setAppearanceSettings: (payload) => ipcRenderer.invoke('settings:setAppearance', payload),
    listProjectTree: () => ipcRenderer.invoke('project:listTree'),
    readProjectFile: (payload) => ipcRenderer.invoke('project:readFile', payload),
    gitStatus: () => ipcRenderer.invoke('git:status'),
    gitCommit: (payload) => ipcRenderer.invoke('git:commit', payload),
    gitStageFile: (payload) => ipcRenderer.invoke('git-stage-file', payload),
    gitUnstageFile: (payload) => ipcRenderer.invoke('git-unstage-file', payload),
    gitRevertFile: (payload) => ipcRenderer.invoke('git-revert-file', payload),
    gitGetDiffContent: (payload) => ipcRenderer.invoke('git-get-diff-content', payload),
    databaseConnect: (payload) => ipcRenderer.invoke('database-connect', payload),
    databaseGetTables: () => ipcRenderer.invoke('database-get-tables'),
    dbFetchRows: (payload) => ipcRenderer.invoke('db-fetch-rows', payload),
    dbDeleteRow: (payload) => ipcRenderer.invoke('db-delete-row', payload),
    dbInsertRow: (payload) => ipcRenderer.invoke('db-insert-row', payload),
    dbSaveConnection: (payload) => ipcRenderer.invoke('db-save-connection', payload),
    dbGetSavedConnections: () => ipcRenderer.invoke('db-get-saved-connections'),
    dbDeleteConnection: (payload) => ipcRenderer.invoke('db-delete-connection', payload),
    terminalCreate: (payload) => ipcRenderer.invoke('terminal-create', payload),
    terminalList: () => ipcRenderer.invoke('terminal-list'),
    terminalSendInput: (payload) => ipcRenderer.invoke('terminal-send-input', payload),
    terminalResize: (payload) => ipcRenderer.invoke('terminal-resize', payload),
    terminalClose: (payload) => ipcRenderer.invoke('terminal-close', payload),
    sendTerminalInput: (payload) => ipcRenderer.invoke('terminal-send-input', payload),
    terminalRestartShell: () => ipcRenderer.invoke('terminal-restart-shell'),
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
    onModelDownloadProgress: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('ai:model-download-progress', handler);
        return () => ipcRenderer.removeListener('ai:model-download-progress', handler);
    },
    onWindowMaximizedChanged: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('window:maximizedChanged', handler);
        return () => ipcRenderer.removeListener('window:maximizedChanged', handler);
    },
    onTerminalOutput: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('terminal-get-output', handler);
        return () => ipcRenderer.removeListener('terminal-get-output', handler);
    },
    llamaStatus: () => ipcRenderer.invoke('llama:status'),
    startLlama: () => ipcRenderer.invoke('llama:start'),
    stopLlama: () => ipcRenderer.invoke('llama:stop'),
    terminalExecute: (payload) => ipcRenderer.invoke('mcp:terminalExecute', payload),
    duckduckgoSearch: (payload) => ipcRenderer.invoke('mcp:duckduckgoSearch', payload),
});

contextBridge.exposeInMainWorld('electronAPI', {
    sendTerminalInput: (payload) => ipcRenderer.invoke('terminal-send-input', payload),
});
