import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('palRuntime', {
    getWorkspaceRoot: () => ipcRenderer.invoke('runtime:getWorkspaceRoot'),
    setWorkspaceRoot: (payload) => ipcRenderer.invoke('runtime:setWorkspaceRoot', payload),
    getRecentWorkspaces: () => ipcRenderer.invoke('runtime:getRecentWorkspaces'),
    clearRecentWorkspaces: () => ipcRenderer.invoke('runtime:clearRecentWorkspaces'),
    openWorkspaceFolder: (payload) => ipcRenderer.invoke('runtime:openWorkspaceFolder', payload),
    pickWorkspaceFolder: () => ipcRenderer.invoke('runtime:pickWorkspaceFolder'),
    bootstrapRuntime: () => ipcRenderer.invoke('runtime:bootstrap'),
    cancelBootstrapRuntime: () => ipcRenderer.invoke('runtime:cancelBootstrap'),
    getHardwareMetrics: () => ipcRenderer.invoke('runtime:getHardwareMetrics'),
    getAiAssistantSettings: () => ipcRenderer.invoke('ai:get-settings'),
    setAiAssistantSettings: (payload) => ipcRenderer.invoke('ai:set-settings', payload),
    checkLocalModels: () => ipcRenderer.invoke('check-local-models'),

    lmStudioGetModels: (payload) => ipcRenderer.invoke('lmstudio:get-models', payload),
    lmStudioLoadModel: (payload) => ipcRenderer.invoke('lmstudio:load-model', payload),
    getAppearanceSettings: () => ipcRenderer.invoke('settings:getAppearance'),
    setAppearanceSettings: (payload) => ipcRenderer.invoke('settings:setAppearance', payload),
    listProjectTree: () => ipcRenderer.invoke('project:listTree'),
    readProjectFile: (payload) => ipcRenderer.invoke('project:readFile', payload),
    workspaceCopyText: (payload) => ipcRenderer.invoke('workspace:copy-text', payload),
    workspaceReadFile: (payload) => ipcRenderer.invoke('workspace:read-file', payload),
    workspaceSearchText: (payload) => ipcRenderer.invoke('workspace:search-text', payload),
    workspaceGetErrors: (payload) => ipcRenderer.invoke('workspace:get-errors', payload),
    workspaceDeleteFile: (payload) => ipcRenderer.invoke('workspace:delete-file', payload),
    workspaceRenamePath: (payload) => ipcRenderer.invoke('workspace:rename-path', payload),
    workspacePastePath: (payload) => ipcRenderer.invoke('workspace:paste-path', payload),
    workspaceCreatePath: (payload) => ipcRenderer.invoke('workspace:create-path', payload),
    workspaceRevealPath: (payload) => ipcRenderer.invoke('workspace:reveal-path', payload),
    workspaceWriteFile: (payload) => ipcRenderer.invoke('workspace:write-file', payload),
    saveCurrentFile: (payload) => ipcRenderer.invoke('workspace:save-current-file', payload),
    workspacePatchFile: (payload) => ipcRenderer.invoke('workspace:patch-file', payload),
    workspaceListFiles: (payload) => ipcRenderer.invoke('workspace:list-files', payload || {}),
    workspaceListDir: (payload) => ipcRenderer.invoke('workspace:list-dir', payload || {}),
    workspaceSearchPaths: (payload) => ipcRenderer.invoke('workspace:search-paths', payload || {}),
    workspaceFetchWebpage: (payload) => ipcRenderer.invoke('workspace:fetch-webpage', payload || {}),
    workspaceIndexStats: () => ipcRenderer.invoke('workspace:index-stats'),
    workspaceIndexPaths: () => ipcRenderer.invoke('workspace:index-paths'),
    workspaceIndexSearch: (pattern) => ipcRenderer.invoke('workspace:index-search', pattern),
    workspaceIndexLookup: (relativePath) => ipcRenderer.invoke('workspace:index-lookup', relativePath),
    workspaceIndexFindFile: (name) => ipcRenderer.invoke('workspace:index-find-file', name),
    gitStatus: () => ipcRenderer.invoke('git:status'),
    gitCommit: (payload) => ipcRenderer.invoke('git:commit', payload),
    gitStageFile: (payload) => ipcRenderer.invoke('git-stage-file', payload),
    gitUnstageFile: (payload) => ipcRenderer.invoke('git-unstage-file', payload),
    gitRevertFile: (payload) => ipcRenderer.invoke('git-revert-file', payload),
    gitStageAll: () => ipcRenderer.invoke('git-stage-all'),
    gitUnstageAll: () => ipcRenderer.invoke('git-unstage-all'),
    gitRevertAll: () => ipcRenderer.invoke('git-revert-all'),
    gitGetDiffContent: (payload) => ipcRenderer.invoke('git-get-diff-content', payload),
    databaseConnect: (payload) => ipcRenderer.invoke('database-connect', payload),
    databaseGetTables: () => ipcRenderer.invoke('database-get-tables'),
    dbFetchRows: (payload) => ipcRenderer.invoke('db-fetch-rows', payload),
    dbDeleteRow: (payload) => ipcRenderer.invoke('db-delete-row', payload),
    dbUpdateRow: (payload) => ipcRenderer.invoke('db-update-row', payload),
    dbInsertRow: (payload) => ipcRenderer.invoke('db-insert-row', payload),
    dbSaveConnection: (payload) => ipcRenderer.invoke('db-save-connection', payload),
    dbGetSavedConnections: () => ipcRenderer.invoke('db-get-saved-connections'),
    dbDeleteConnection: (payload) => ipcRenderer.invoke('db-delete-connection', payload),
    dbFetchSchema: (payload) => ipcRenderer.invoke('db-fetch-schema', payload),
    dbGetRowCount: (payload) => ipcRenderer.invoke('db-get-row-count', payload),
    dbExecuteQuery: (payload) => ipcRenderer.invoke('db-execute-query', payload),
    dbBrowseSqlite: () => ipcRenderer.invoke('db-browse-sqlite'),
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
    onTerminalStatus: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('terminal:status', handler);
        return () => ipcRenderer.removeListener('terminal:status', handler);
    },
    onAppShortcut: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('app:shortcut', handler);
        return () => ipcRenderer.removeListener('app:shortcut', handler);
    },
    onAgentStepUpdate: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('agent:step-update', handler);
        return () => ipcRenderer.removeListener('agent:step-update', handler);
    },

    terminalExecute: (payload) => ipcRenderer.invoke('mcp:terminalExecute', payload),
    duckduckgoSearch: (payload) => ipcRenderer.invoke('mcp:duckduckgoSearch', payload),
});

contextBridge.exposeInMainWorld('electronAPI', {
    sendTerminalInput: (payload) => ipcRenderer.invoke('terminal-send-input', payload),
    saveCurrentFile: (payload) => ipcRenderer.invoke('workspace:save-current-file', payload),
    saveChatSession: (sessionId, messages) => ipcRenderer.invoke('save-chat-session', { sessionId, messages }),
    loadChatSession: (sessionId) => ipcRenderer.invoke('load-chat-session', { sessionId }),
    onDiskChanged: (listener) => {
        const handler = () => listener();
        ipcRenderer.on('workspace:disk-changed', handler);
        return () => ipcRenderer.removeListener('workspace:disk-changed', handler);
    },
});

contextBridge.exposeInMainWorld('aiRuntime', {
    sendPrompt: (payload) => ipcRenderer.invoke('ai:send-prompt', payload),
    respondToAction: (payload) => ipcRenderer.invoke('ai:respond-action', payload),
    cancelSession: (payload) => ipcRenderer.invoke('ai:cancel-session', payload),
    onStreamChunk: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('ai:stream-chunk', handler);
        return () => ipcRenderer.removeListener('ai:stream-chunk', handler);
    },
    onThinkingChunk: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('ai:thinking-chunk', handler);
        return () => ipcRenderer.removeListener('ai:thinking-chunk', handler);
    },
    onStreamText: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('ai:stream-text', handler);
        return () => ipcRenderer.removeListener('ai:stream-text', handler);
    },
    onNativeAction: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('ai:native-action', handler);
        return () => ipcRenderer.removeListener('ai:native-action', handler);
    },
    onActionPending: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('ai:action-pending', handler);
        return () => ipcRenderer.removeListener('ai:action-pending', handler);
    },
    onActionResult: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('ai:action-result', handler);
        return () => ipcRenderer.removeListener('ai:action-result', handler);
    },
    onAiError: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('ai:error', handler);
        return () => ipcRenderer.removeListener('ai:error', handler);
    },
    onAiDone: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('ai:done', handler);
        return () => ipcRenderer.removeListener('ai:done', handler);
    },
    onValidationStart: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('validation:start', handler);
        return () => ipcRenderer.removeListener('validation:start', handler);
    },
    onValidationResult: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on('validation:result', handler);
        return () => ipcRenderer.removeListener('validation:result', handler);
    },
});

contextBridge.exposeInMainWorld('projectRuntime', {
    metadata: () => ipcRenderer.invoke('project:metadata'),
    metadataSummary: () => ipcRenderer.invoke('project:metadata-summary'),
    metadataRefresh: () => ipcRenderer.invoke('project:metadata-refresh'),
    codeSearch: (query) => ipcRenderer.invoke('codesearch:search', query),
    codeSearchByType: (type) => ipcRenderer.invoke('codesearch:find-by-type', type),
    codeSearchByName: (name) => ipcRenderer.invoke('codesearch:find-by-name', name),
    codeSearchByFile: (filePath) => ipcRenderer.invoke('codesearch:find-by-file', filePath),
    codeSearchStats: () => ipcRenderer.invoke('codesearch:stats'),
    codeSearchSummary: () => ipcRenderer.invoke('codesearch:summary'),
    codeSearchRefresh: () => ipcRenderer.invoke('codesearch:refresh'),
    patchSearchReplace: (payload) => ipcRenderer.invoke('patch:search-replace', payload),
    patchPreviewPatch: (payload) => ipcRenderer.invoke('patch:preview-patch', payload),
    patchUnifiedDiff: (payload) => ipcRenderer.invoke('patch:unified-diff', payload),
    patchCreateDiff: (payload) => ipcRenderer.invoke('patch:create-diff', payload),
    patchRollback: (payload) => ipcRenderer.invoke('patch:rollback', payload),
    validationLint: () => ipcRenderer.invoke('validation:lint'),
    validationTypecheck: () => ipcRenderer.invoke('validation:typecheck'),
    validationBuild: () => ipcRenderer.invoke('validation:build'),
    validationTests: (payload) => ipcRenderer.invoke('validation:tests', payload),
    validationAll: () => ipcRenderer.invoke('validation:all'),
    validationTrigger: () => ipcRenderer.invoke('validation:trigger'),
});
