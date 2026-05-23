export { };

declare global {
    interface Window {
        palRuntime?: {
            getWorkspaceRoot: () => Promise<{ cwd: string }>;
            setWorkspaceRoot: (payload: { cwd?: string }) => Promise<{ cwd: string }>;
            getRecentWorkspaces: () => Promise<{ items: string[] }>;
            clearRecentWorkspaces: () => Promise<{ items: string[] }>;
            openWorkspaceFolder: (payload: { cwd: string }) => Promise<{
                ok: boolean;
                cwd: string;
                error?: string;
            }>;
            pickWorkspaceFolder: () => Promise<{ cancelled: boolean; cwd: string }>;
            bootstrapRuntime: () => Promise<Record<string, unknown>>;
            cancelBootstrapRuntime: () => Promise<Record<string, unknown>>;
            getHardwareMetrics: () => Promise<{ vramUsed: number; vramTotal: number }>;
            getAiAssistantSettings: () => Promise<{
                engine: 'llama-server' | 'lm-studio';
                roleMappings: {
                    coding: string;
                    vision: string;
                    autocomplete: string;
                };
                lmStudio: {
                    endpointUrl: string;
                    port: string;
                    activeModel: string;
                };
                llamaServer: {
                    selectedFlavor: 'auto' | 'cpu' | 'cuda' | 'vulkan';
                };
            }>;
            setAiAssistantSettings: (payload: {
                engine?: 'llama-server' | 'lm-studio';
                roleMappings?: Partial<{
                    coding: string;
                    vision: string;
                    autocomplete: string;
                }>;
                lmStudio?: Partial<{
                    endpointUrl: string;
                    port: string;
                    activeModel: string;
                }>;
                llamaServer?: Partial<{
                    selectedFlavor: 'auto' | 'cpu' | 'cuda' | 'vulkan';
                }>;
            }) => Promise<{
                engine: 'llama-server' | 'lm-studio';
                roleMappings: {
                    coding: string;
                    vision: string;
                    autocomplete: string;
                };
                lmStudio: {
                    endpointUrl: string;
                    port: string;
                    activeModel: string;
                };
                llamaServer: {
                    selectedFlavor: 'auto' | 'cpu' | 'cuda' | 'vulkan';
                };
            }>;
            checkLocalModels: () => Promise<{
                modelsDir: string;
                models: Array<{
                    id: string;
                    role: string;
                    name: string;
                    fileName: string;
                    localPath: string;
                    downloaded: boolean;
                }>;
            }>;
            checkLocalLlamaServers: () => Promise<{
                llamaServerDir: string;
                active: Record<string, unknown> | null;
                versions: Array<{
                    flavor: 'cpu' | 'cuda' | 'vulkan';
                    installed: boolean;
                    executablePath: string;
                    active: boolean;
                }>;
            }>;
            downloadLlamaServerVersion: (payload: { flavor: 'auto' | 'cpu' | 'cuda' | 'vulkan' }) => Promise<{
                ok: boolean;
                requestedFlavor: string;
                installedFlavor?: string;
                executablePath?: string;
                assetName?: string;
            }>;
            lmStudioGetModels: (payload: {
                endpointUrl?: string;
                port?: string;
            }) => Promise<{
                endpoint: string;
                models: Array<{ id: string }>;
            }>;
            llamaStatus: () => Promise<{
                status: string;
                ready: boolean;
                pid?: number | null;
                message?: string;
                recentOutput?: string;
            }>;
            startLlama: () => Promise<{
                status: string;
                ready: boolean;
                pid?: number | null;
                message?: string;
                recentOutput?: string;
            }>;
            stopLlama: () => Promise<{
                status: string;
                ready: boolean;
                pid?: number | null;
                message?: string;
                recentOutput?: string;
            }>;
            getAppearanceSettings: () => Promise<{
                paneDimensions: {
                    leftSidebarWidth: number;
                    rightChatWidth: number;
                    terminalHeightRatio: number;
                };
            }>;
            setAppearanceSettings: (payload: {
                paneDimensions: Partial<{
                    leftSidebarWidth: number;
                    rightChatWidth: number;
                    terminalHeightRatio: number;
                }>;
            }) => Promise<{
                paneDimensions: {
                    leftSidebarWidth: number;
                    rightChatWidth: number;
                    terminalHeightRatio: number;
                };
            }>;
            listProjectTree: () => Promise<{
                root: string;
                tree: Array<{
                    id: string;
                    name: string;
                    path: string;
                    relativePath: string;
                    isDirectory: boolean;
                    children?: unknown[];
                }>;
            }>;
            readProjectFile: (payload: { path: string }) => Promise<{
                path: string;
                content: string;
            }>;
            workspaceCopyText: (payload: { text: string }) => Promise<{
                ok: boolean;
                text: string;
            }>;
            workspaceReadFile: (payload: { path: string; traceId?: string }) => Promise<
                | {
                    ok: true;
                    path: string;
                    content: string;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            workspaceDeleteFile: (payload: { path: string; traceId?: string }) => Promise<
                | {
                    ok: true;
                    path: string;
                    isDirectory: boolean;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            workspaceRenamePath: (payload: {
                path: string;
                name: string;
                traceId?: string;
            }) => Promise<
                | {
                    ok: true;
                    fromPath: string;
                    path: string;
                    isDirectory: boolean;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            workspacePastePath: (payload: {
                sourcePath: string;
                targetPath: string;
                mode?: 'copy' | 'cut';
                traceId?: string;
            }) => Promise<
                | {
                    ok: true;
                    path: string;
                    mode: 'copy' | 'cut';
                    sourcePath: string;
                    isDirectory: boolean;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            workspaceCreatePath: (payload: {
                parentPath?: string;
                name: string;
                type?: 'file' | 'folder';
                traceId?: string;
            }) => Promise<
                | {
                    ok: true;
                    path: string;
                    isDirectory: boolean;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            workspaceRevealPath: (payload: { path: string }) => Promise<
                | {
                    ok: true;
                    path: string;
                    isDirectory: boolean;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            saveCurrentFile: (payload: {
                filePath: string;
                content: string;
                traceId?: string;
            }) => Promise<
                | {
                    ok: true;
                    filePath: string;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            workspaceWriteFile: (payload: {
                path: string;
                content: string;
                backup?: boolean;
                traceId?: string;
            }) => Promise<
                | {
                    ok: true;
                    path: string;
                    backupPath: string;
                    bytes: number;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            workspacePatchFile: (payload: {
                path: string;
                patches: Array<{
                    find?: string;
                    replace?: string;
                    replaceAll?: boolean;
                    startLine?: number;
                    endLine?: number;
                    text?: string;
                }>;
                backup?: boolean;
                traceId?: string;
            }) => Promise<
                | {
                    ok: true;
                    path: string;
                    backupPath: string;
                    bytes: number;
                    appliedCount: number;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            workspaceListFiles: (payload?: { traceId?: string }) => Promise<
                | {
                    ok: true;
                    root: string;
                    tree: Array<{
                        name: string;
                        path: string;
                        isDirectory: boolean;
                        children?: unknown[];
                    }>;
                    truncated: boolean;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            gitStatus: () => Promise<{
                isRepo: boolean;
                branch: string | null;
                staged: Array<{ path: string; index: string; workingDir: string; additions: number; deletions: number; isBinary: boolean }>;
                unstaged: Array<{ path: string; index: string; workingDir: string; additions: number; deletions: number; isBinary: boolean }>;
            }>;
            gitCommit: (payload: { message: string }) => Promise<{
                commit: string;
                summary: unknown;
            }>;
            gitStageFile: (payload: { filePath: string }) => Promise<{
                staged: boolean;
                filePath: string;
            }>;
            gitUnstageFile: (payload: { filePath: string }) => Promise<{
                unstaged: boolean;
                filePath: string;
            }>;
            gitRevertFile: (payload: { filePath: string }) => Promise<{
                reverted: boolean;
                filePath: string;
            }>;
            gitStageAll: () => Promise<{
                stagedAll: boolean;
            }>;
            gitUnstageAll: () => Promise<{
                unstagedAll: boolean;
            }>;
            gitRevertAll: () => Promise<{
                revertedAll: boolean;
            }>;
            gitGetDiffContent: (payload: { filePath: string }) => Promise<{
                filePath: string;
                original: string;
                modified: string;
            }>;
            databaseConnect: (payload: {
                driver?: 'mysql' | 'sqlite';
                host: string;
                user: string;
                password?: string;
                database: string;
                port?: number;
                sqlitePath?: string;
            }) => Promise<{
                connected: boolean;
                database: string;
                driver?: string;
            }>;
            databaseGetTables: () => Promise<{
                tables: string[];
            }>;
            dbFetchRows: (payload: {
                table: string;
                offset?: number;
                limit?: number;
                sortColumn?: string;
                sortDirection?: 'asc' | 'desc';
            }) => Promise<{
                rows: Array<Record<string, unknown>>;
                columns: Array<{ name: string; type?: number | string; table?: string }>;
                totalCount: number;
                offset: number;
                limit: number;
            }>;
            dbDeleteRow: (payload: { table: string; id: string | number }) => Promise<{
                affectedRows: number;
            }>;
            dbUpdateRow: (payload: {
                table: string;
                id: string | number;
                row: Record<string, unknown>;
            }) => Promise<{
                affectedRows: number;
            }>;
            dbInsertRow: (payload: {
                table: string;
                row: Record<string, unknown>;
            }) => Promise<{
                insertId: number;
                affectedRows: number;
            }>;
            dbSaveConnection: (payload: {
                driver?: 'mysql' | 'sqlite';
                alias: string;
                host: string;
                port?: number;
                user: string;
                password?: string;
                database: string;
                sqlitePath?: string;
            }) => Promise<{
                saved: boolean;
                profiles: Array<{
                    driver: 'mysql' | 'sqlite';
                    alias: string;
                    host: string;
                    port: number;
                    user: string;
                    password: string;
                    database: string;
                    sqlitePath: string;
                    updatedAt: string;
                }>;
            }>;
            dbGetSavedConnections: () => Promise<{
                profiles: Array<{
                    driver: 'mysql' | 'sqlite';
                    alias: string;
                    host: string;
                    port: number;
                    user: string;
                    password: string;
                    database: string;
                    sqlitePath: string;
                    updatedAt: string;
                }>;
            }>;
            dbDeleteConnection: (payload: { alias: string }) => Promise<{
                deleted: boolean;
                profiles: Array<{
                    driver: 'mysql' | 'sqlite';
                    alias: string;
                    host: string;
                    port: number;
                    user: string;
                    password: string;
                    database: string;
                    sqlitePath: string;
                    updatedAt: string;
                }>;
            }>;
            dbFetchSchema: (payload: { table: string }) => Promise<{
                table: string;
                columns: Array<{
                    name: string;
                    type: string;
                    nullable: boolean;
                    key: string;
                    default: unknown;
                }>;
                driver: string;
            }>;
            dbGetRowCount: (payload: { table: string }) => Promise<{
                count: number;
                table: string;
            }>;
            dbExecuteQuery: (payload: { query: string }) => Promise<{
                rows: Array<Record<string, unknown>>;
                columns: Array<{ name: string; type: string; table: string }>;
                affectedRows: number;
            }>;
            dbBrowseSqlite: () => Promise<string | null>;
            terminalCreate: (payload?: {
                terminalId?: string;
                cols?: number;
                rows?: number;
            }) => Promise<{ ok: boolean; terminalId: string; cwd: string }>;
            terminalList: () => Promise<{
                terminals: Array<{
                    terminalId: string;
                    cwd: string;
                }>;
            }>;
            terminalSendInput: (payload: { terminalId?: string; command: string }) => Promise<{ ok: boolean }>;
            terminalResize: (payload: { terminalId: string; cols: number; rows: number }) => Promise<{ ok: boolean }>;
            terminalClose: (payload: { terminalId: string }) => Promise<{ ok: boolean }>;
            terminalRestartShell: (payload?: {
                terminalId?: string;
                cols?: number;
                rows?: number;
            }) => Promise<{ ok: boolean; terminalId: string; cwd: string }>;
            minimizeWindow: () => Promise<{ ok: boolean }>;
            toggleMaximizeWindow: () => Promise<{ ok: boolean; maximized: boolean }>;
            closeWindow: () => Promise<{ ok: boolean }>;
            getWindowMaximized: () => Promise<{ maximized: boolean }>;
            onDownloadProgress: (
                listener: (payload: {
                    stage?: string;
                    label?: string;
                    percent?: number;
                    inProgress?: boolean;
                    completed?: boolean;
                    cancelled?: boolean;
                    error?: boolean;
                    downloadedBytes?: number;
                    totalBytes?: number;
                }) => void,
            ) => () => void;
            onHardwareMetrics: (listener: (payload: { vramUsed: number; vramTotal: number }) => void) => () => void;
            onModelDownloadProgress: (
                listener: (payload: {
                    modelId: string;
                    inProgress?: boolean;
                    completed?: boolean;
                    error?: boolean;
                    message?: string;
                    percent?: number;
                    downloadedBytes?: number;
                    totalBytes?: number;
                    filePath?: string;
                }) => void,
            ) => () => void;
            onWindowMaximizedChanged: (listener: (payload: { maximized: boolean }) => void) => () => void;
            onTerminalOutput: (
                listener: (payload: { terminalId: string; data: string } | string) => void,
            ) => () => void;
            onAppShortcut: (
                listener: (payload: {
                    id:
                    | 'toggle-terminal'
                    | 'toggle-chat-panel';
                }) => void,
            ) => () => void;
            onAgentStepUpdate: (
                listener: (payload: {
                    type: 'read' | 'search' | 'write';
                    status: 'pending' | 'success';
                    target: string;
                    details: string;
                    traceId?: string;
                }) => void,
            ) => () => void;
            llamaStatus: () => Promise<{
                status: string;
                ready: boolean;
                pid?: number | null;
                message?: string;
                portOpen?: boolean;
                healthOk?: boolean;
                cwd?: string;
            }>;
            startLlama: () => Promise<Record<string, unknown>>;
            stopLlama: () => Promise<Record<string, unknown>>;
            saveCurrentFile: (payload: {
                filePath: string;
                content: string;
            }) => Promise<
                | {
                    ok: true;
                    filePath: string;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            terminalExecute: (payload: {
                command: string;
                shell?: 'powershell' | 'cmd';
                timeoutMs?: number;
            }) => Promise<Record<string, unknown>>;
            duckduckgoSearch: (payload: {
                query: string;
                maxResults?: number;
            }) => Promise<Record<string, unknown>>;
        };
        electronAPI?: {
            sendTerminalInput: (payload: { terminalId?: string; command: string }) => Promise<{ ok: boolean }>;
            saveCurrentFile: (payload: {
                filePath: string;
                content: string;
                traceId?: string;
            }) => Promise<
                | {
                    ok: true;
                    filePath: string;
                }
                | {
                    ok: false;
                    error: {
                        code: string;
                        message: string;
                    };
                }
            >;
            saveChatSession: (
                sessionId: string,
                session: {
                    messages: Array<{ id: string; role: string; text: string; status: string }>;
                    appliedActionIds?: string[];
                } | Array<{ id: string; role: string; text: string; status: string }>,
            ) => Promise<{ ok: boolean }>;
            loadChatSession: (
                sessionId: string,
            ) => Promise<
                | {
                    messages: Array<{ id: string; role: string; text: string; status: string }>;
                    appliedActionIds: string[];
                }
                | Array<{ id: string; role: string; text: string; status: string }>
            >;
            onDiskChanged: (listener: () => void) => () => void;
        };
    }
}
