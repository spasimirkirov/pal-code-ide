export { };

declare global {
    interface Window {
        palRuntime?: {
            getWorkspaceRoot: () => Promise<{ cwd: string }>;
            setWorkspaceRoot: (payload: { cwd?: string }) => Promise<{ cwd: string }>;
            bootstrapRuntime: () => Promise<Record<string, unknown>>;
            cancelBootstrapRuntime: () => Promise<Record<string, unknown>>;
            getHardwareMetrics: () => Promise<{ vramUsed: number; vramTotal: number }>;
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
            onWindowMaximizedChanged: (listener: (payload: { maximized: boolean }) => void) => () => void;
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
