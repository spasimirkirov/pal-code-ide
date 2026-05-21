export { };

declare global {
    interface Window {
        palRuntime?: {
            getWorkspaceRoot: () => Promise<{ cwd: string }>;
            setWorkspaceRoot: (payload: { cwd?: string }) => Promise<{ cwd: string }>;
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
            gitStatus: () => Promise<{
                isRepo: boolean;
                branch: string | null;
                staged: Array<{ path: string; index: string; workingDir: string }>;
                unstaged: Array<{ path: string; index: string; workingDir: string }>;
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
            gitGetDiffContent: (payload: { filePath: string }) => Promise<{
                filePath: string;
                original: string;
                modified: string;
            }>;
            databaseConnect: (payload: {
                host: string;
                user: string;
                password?: string;
                database: string;
                port?: number;
            }) => Promise<{
                connected: boolean;
                database: string;
            }>;
            databaseGetTables: () => Promise<{
                tables: string[];
            }>;
            dbFetchRows: (payload: { table: string }) => Promise<{
                rows: Array<Record<string, unknown>>;
                columns: Array<{ name: string; type?: number; table?: string }>;
            }>;
            dbDeleteRow: (payload: { table: string; id: string | number }) => Promise<{
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
                alias: string;
                host: string;
                port?: number;
                user: string;
                password?: string;
                database: string;
            }) => Promise<{
                saved: boolean;
                profiles: Array<{
                    alias: string;
                    host: string;
                    port: number;
                    user: string;
                    password: string;
                    database: string;
                    updatedAt: string;
                }>;
            }>;
            dbGetSavedConnections: () => Promise<{
                profiles: Array<{
                    alias: string;
                    host: string;
                    port: number;
                    user: string;
                    password: string;
                    database: string;
                    updatedAt: string;
                }>;
            }>;
            dbDeleteConnection: (payload: { alias: string }) => Promise<{
                deleted: boolean;
                profiles: Array<{
                    alias: string;
                    host: string;
                    port: number;
                    user: string;
                    password: string;
                    database: string;
                    updatedAt: string;
                }>;
            }>;
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
    }
}
