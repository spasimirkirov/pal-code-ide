import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { LoaderCircle, DownloadCloud } from 'lucide-react';
import EditorPanel from './components/EditorPanel';
import ChatPanel from './components/ChatPanel';
import GitDiffPanel from './components/GitDiffPanel';
import DatabaseViewerPanel from './components/database/DatabaseViewerPanel';
import GitWorkspacePanel from './components/git/GitWorkspacePanel';
import IdeTitleBar from './components/chrome/IdeTitleBar';
import SidebarPanel from './components/sidebar/SidebarPanel';
import AiAssistantPanel from './components/sidebar/AiAssistantPanel';
import midnight from './config/muiTheme';
import './index.css';

const runtime = window.palRuntime;
const PREVIEW_TAB_ID = '__preview__';
const DEFAULT_PANE_DIMENSIONS = {
    leftSidebarWidth: 360,
    rightChatWidth: 432,
    terminalHeightRatio: 0.27,
};

function App() {
    const untitledCounterRef = useRef(1);
    const saveTimerRef = useRef(null);
    const saveStatusTimerRef = useRef(null);
    const saveInProgressRef = useRef(false);
    const openTabsRef = useRef(false);
    const [editorCode, setEditorCode] = useState(
        '# PAL IDE\n# Ask the agent to generate or refactor code here.\n\nprint("Hello from PAL IDE")\n',
    );
    const [activeFilePath, setActiveFilePath] = useState('untitled.py');
    const [activeView, setActiveView] = useState('editor');
    const [chatVisible, setChatVisible] = useState(true);
    const [isWindowMaximized, setIsWindowMaximized] = useState(true);
    const [paneDimensions, setPaneDimensions] = useState({ ...DEFAULT_PANE_DIMENSIONS });
    const [workspaceRoot, setWorkspaceRoot] = useState('');
    const [hardware, setHardware] = useState({ vramUsed: 0, vramTotal: 0 });
    const [modelPerf, setModelPerf] = useState({
        tokensPerSec: 0, contextUsed: 0, contextTotal: 32000,
    });

    const [bootstrapState, setBootstrapState] = useState({
        visible: true, inProgress: true, label: 'Preparing PAL runtime...',
        percent: 0, stage: 'init', canDismiss: false, cancelled: false, error: false,
    });
    const [openTabs, setOpenTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [prevCode, setPrevCode] = useState('');
    const [sidebarActiveTab, setSidebarActiveTab] = useState(null);

    const [dbConnected, setDbConnected] = useState(false);
    const [dbDatabaseName, setDbDatabaseName] = useState('');
    const [dbTables, setDbTables] = useState([]);
    const [dbLoadingTables, setDbLoadingTables] = useState(false);
    const [dbSavedConnections, setDbSavedConnections] = useState([]);
    const [dbConnecting, setDbConnecting] = useState(false);
    const [dbConnectionError, setDbConnectionError] = useState('');
    const [dbTabs, setDbTabs] = useState([]);
    const [activeDbTabId, setActiveDbTabId] = useState(null);

    const refreshSavedConnections = useCallback(async () => {
        if (!runtime?.dbGetSavedConnections) return;
        try {
            const result = await runtime.dbGetSavedConnections();
            if (result?.profiles) setDbSavedConnections(result.profiles);
        } catch { /* */ }
    }, []);

    const connectDatabase = useCallback(async (profile) => {
        if (!runtime?.databaseConnect) return;
        setDbConnecting(true);
        setDbConnectionError('');
        try {
            const result = await runtime.databaseConnect(profile);
            setDbConnected(true);
            setDbDatabaseName(result?.database || profile.database || profile.alias || '');
            const tableResult = await runtime.databaseGetTables();
            setDbTables(Array.isArray(tableResult?.tables) ? tableResult.tables : []);
        } catch (error) {
            setDbConnectionError(error?.message || 'Connection failed.');
            setDbConnected(false);
            setDbDatabaseName('');
            setDbTables([]);
        } finally { setDbConnecting(false); }
    }, []);

    const disconnectDatabase = useCallback(async () => {
        if (!runtime?.databaseConnect) return;
        setDbConnected(false);
        setDbDatabaseName('');
        setDbTables([]);
        setDbTabs([]);
        setActiveDbTabId(null);
    }, []);

    const refreshDatabaseTables = useCallback(async () => {
        if (!runtime?.databaseGetTables || !dbConnected) return;
        setDbLoadingTables(true);
        try {
            const tableResult = await runtime.databaseGetTables();
            setDbTables(Array.isArray(tableResult?.tables) ? tableResult.tables : []);
        } catch { /* */ }
        finally { setDbLoadingTables(false); }
    }, [dbConnected]);

    useEffect(() => {
        let isMounted = true;
        let unsubscribe = null;
        let unsubscribeHardware = null;
        let unsubscribeWindowState = null;

        const runBootstrap = async () => {
            if (!runtime) return;
            setBootstrapState((current) => ({ ...current, visible: true, inProgress: true, canDismiss: false }));
            try {
                await runtime.bootstrapRuntime();
                if (!isMounted) return;
                setBootstrapState({ visible: false, inProgress: false, label: 'Runtime assets ready.', percent: 100, canDismiss: true, stage: 'complete', cancelled: false, error: false });
            } catch (error) {
                if (!isMounted) return;
                setBootstrapState((current) => ({ ...current, inProgress: false, canDismiss: true, label: error?.message || 'Runtime setup failed.', error: true }));
            }
        };

        const hydrateRuntime = async () => {
            if (!runtime) return;
            try {
                const currentRoot = await runtime.getWorkspaceRoot();
                const syncedRoot = await runtime.setWorkspaceRoot({ cwd: currentRoot?.cwd });
                if (isMounted) setWorkspaceRoot(syncedRoot?.cwd || currentRoot?.cwd || '');
            } catch { /* */ }
        };

        if (runtime?.onDownloadProgress) {
            unsubscribe = runtime.onDownloadProgress((progress) => {
                if (!isMounted || !progress) return;
                setBootstrapState((current) => {
                    const stage = String(progress.stage || current.stage);
                    return {
                        ...current, visible: !progress.completed, inProgress: Boolean(progress.inProgress),
                        label: progress.label || current.label, percent: Number.isFinite(progress.percent) ? progress.percent : current.percent,
                        stage, canDismiss: Boolean(progress.completed || progress.cancelled || progress.error),
                        cancelled: Boolean(progress.cancelled), error: Boolean(progress.error),
                    };
                });
            });
        }

        if (runtime?.onHardwareMetrics) {
            unsubscribeHardware = runtime.onHardwareMetrics((snapshot) => {
                if (!isMounted || !snapshot) return;
                setHardware({ vramUsed: Number(snapshot.vramUsed || 0), vramTotal: Number(snapshot.vramTotal || 0) });
            });
        }

        if (runtime?.getHardwareMetrics) {
            void runtime.getHardwareMetrics().then((snapshot) => {
                if (!isMounted || !snapshot) return;
                setHardware({ vramUsed: Number(snapshot.vramUsed || 0), vramTotal: Number(snapshot.vramTotal || 0) });
            });
        }

        if (runtime?.onWindowMaximizedChanged) {
            unsubscribeWindowState = runtime.onWindowMaximizedChanged((payload) => {
                if (!isMounted || !payload) return;
                setIsWindowMaximized(Boolean(payload.maximized));
            });
        }

        if (runtime?.getWindowMaximized) {
            void runtime.getWindowMaximized().then((payload) => {
                if (!isMounted || !payload) return;
                setIsWindowMaximized(Boolean(payload.maximized));
            });
        }

        if (runtime?.getAppearanceSettings) {
            void runtime.getAppearanceSettings().then((payload) => {
                if (!isMounted || !payload?.paneDimensions) return;
                setPaneDimensions((current) => ({ ...current, ...payload.paneDimensions }));
            });
        }

        void runBootstrap();
        void hydrateRuntime();
        const pollId = window.setInterval(hydrateRuntime, 5000);

        return () => {
            isMounted = false;
            if (unsubscribe) unsubscribe();
            if (unsubscribeHardware) unsubscribeHardware();
            if (unsubscribeWindowState) unsubscribeWindowState();
            window.clearInterval(pollId);
        };
    }, []);

    const persistPaneDimensions = (next) => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => void runtime?.setAppearanceSettings?.({ paneDimensions: next }), 180);
    };

    const updatePaneDimensions = (partial) => {
        setPaneDimensions((current) => {
            const next = { ...current, ...partial };
            persistPaneDimensions(next);
            return next;
        });
    };

    const startLeftResize = (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = paneDimensions.leftSidebarWidth;
        const onMove = (moveEvent) => {
            const nextWidth = Math.max(280, Math.min(780, startWidth + (moveEvent.clientX - startX)));
            updatePaneDimensions({ leftSidebarWidth: nextWidth });
        };
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const startRightResize = (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = paneDimensions.rightChatWidth;
        const onMove = (moveEvent) => {
            const nextWidth = Math.max(320, Math.min(860, startWidth - (moveEvent.clientX - startX)));
            updatePaneDimensions({ rightChatWidth: nextWidth });
        };
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const formatContext = (value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`;
    const vramPercent = hardware.vramTotal > 0 ? Math.max(0, Math.min(100, (hardware.vramUsed / hardware.vramTotal) * 100)) : 0;

    const handleModelMetricsUpdate = ({ tokensPerSec, contextUsed, contextTotal }) => {
        setModelPerf((current) => ({
            tokensPerSec: Number(tokensPerSec || 0), contextUsed: Number(contextUsed || current.contextUsed || 0),
            contextTotal: Number(contextTotal || current.contextTotal || 32000),
        }));
    };

    const handleCancelBootstrap = async () => {
        if (!runtime || !bootstrapState.inProgress) return;
        await runtime.cancelBootstrapRuntime();
        setBootstrapState((current) => ({ ...current, visible: false, inProgress: false, canDismiss: true, cancelled: true, label: 'Download cancelled by user.' }));
    };

    const handleFileOpen = ({ path, content }) => {
        setActiveFilePath(path || 'untitled.py');
        setEditorCode(content ?? '');
        setActiveView('editor');
    };

    const handleWorkspacePathDeleted = () => { /* noop */ };

    const handleOpenDatabaseTable = (tableName) => {
        setActiveTableName(tableName || '');
        setActiveView('database');
    };

    const handleOpenGitDiff = async (filePath) => {
        if (!runtime?.gitGetDiffContent || !filePath) return;
        const payload = await runtime.gitGetDiffContent({ filePath });
        setGitDiffState({ filePath: payload?.filePath || filePath, original: payload?.original || '', modified: payload?.modified || '' });
        setActiveView('git-diff');
    };

    const handleNewFile = () => {
        const nextId = untitledCounterRef.current++;
        setOpenTabs((current) => [...current, { id: `untitled-${nextId}`, path: `untitled-${nextId}.py`, content: '', isDirty: false }]);
        setActiveTabId(`untitled-${nextId}`);
        setActiveFilePath(`untitled-${nextId}.py`);
        setEditorCode('');
        setActiveView('editor');
    };

    const handleOpenDatabaseView = () => {
        setActiveView('database');
    };

    const handleSidebarTabChange = (tab) => {
        setSidebarActiveTab(tab);
        if (tab === 'files') setActiveView('editor');
        else if (tab === 'git') setActiveView('git');
        else if (tab === 'database') setActiveView('database');
        else if (tab === 'ai') setActiveView('ai');
    };

    const handleWindowMinimize = async () => { await runtime?.minimizeWindow?.(); };
    const handleWindowToggleMaximize = async () => {
        const response = await runtime?.toggleMaximizeWindow?.();
        if (response && typeof response.maximized === 'boolean') setIsWindowMaximized(response.maximized);
    };
    const handleWindowClose = async () => { await runtime?.closeWindow?.(); };

    const handleApplyCode = (incomingCode, mode = 'overwrite') => {
        if (!incomingCode) return;
        setActiveView('editor');
        if (mode === 'insert') { setEditorCode((current) => `${current}\n\n${incomingCode}`.trim()); return; }
        setEditorCode(incomingCode);
    };

    const [activeTableName, setActiveTableName] = useState('');
    const [gitDiffState, setGitDiffState] = useState({ filePath: '', original: '', modified: '' });

    return (
        <ThemeProvider theme={midnight}>
            <CssBaseline />
            <div className="futuristic-shell relative flex h-screen flex-col overflow-hidden bg-[#0b0f1a] text-slate-100">

                <IdeTitleBar
                    activeFilePath={activeView === 'database' ? `Database: ${activeTableName || 'Viewer'}` : activeFilePath}
                    onNewFile={handleNewFile}
                    onOpenDatabaseView={handleOpenDatabaseView}
                    onRefreshGit={() => { window.dispatchEvent(new CustomEvent('pal:git-refresh')); }}
                    chatVisible={chatVisible} onToggleChat={() => setChatVisible((current) => !current)}
                    onResetLayout={() => { const next = { ...DEFAULT_PANE_DIMENSIONS }; setPaneDimensions(next); persistPaneDimensions(next); }}
                    isMaximized={isWindowMaximized}
                    onWindowMinimize={handleWindowMinimize} onWindowToggleMaximize={handleWindowToggleMaximize} onWindowClose={handleWindowClose}
                />

                <div className="glass-chrome relative z-10 flex h-7 items-center justify-between border-b px-3 text-[11px] text-slate-300">
                    <p className="truncate text-slate-400">Runtime ready</p>
                    <p className="ml-4 shrink-0 text-slate-400">{workspaceRoot || 'workspace: unknown'}</p>
                </div>

                <main className="relative z-10 flex min-h-0 flex-1 w-full">
                    <section className="glass-chrome shrink-0 border-r" style={{ width: `${paneDimensions.leftSidebarWidth}px` }}>
                        <SidebarPanel
                            workspaceRoot={workspaceRoot}
                            onFileOpen={handleFileOpen}
                            onPathDeleted={handleWorkspacePathDeleted}
                            onOpenDatabaseTable={handleOpenDatabaseTable}
                            onOpenGitDiff={handleOpenGitDiff}
                            databaseConnected={dbConnected} databaseName={dbDatabaseName}
                            databaseTables={dbTables} databaseLoadingTables={dbLoadingTables}
                            onRefreshDatabaseTables={refreshDatabaseTables}
                            onDisconnectDatabase={disconnectDatabase}
                            activeTab={sidebarActiveTab}
                            onActiveTabChange={handleSidebarTabChange}
                        />
                    </section>

                    <div role="separator" aria-orientation="vertical" onMouseDown={startLeftResize}
                        className="w-1 shrink-0 cursor-col-resize bg-transparent transition hover:bg-cyan-300/25"
                        title="Resize sidebar"
                    />

                    <section className="glass-chrome min-w-0 flex-1 border-x">
                        {activeView === 'database' ? (
                            <DatabaseViewerPanel
                                connected={dbConnected} activeDatabase={dbDatabaseName}
                                tables={dbTables} savedConnections={dbSavedConnections}
                                connecting={dbConnecting} connectionError={dbConnectionError}
                                onConnectConnection={connectDatabase}
                                onDisconnect={disconnectDatabase}
                                onDeleteConnection={async (alias) => {
                                    if (!runtime?.dbDeleteConnection) return;
                                    try {
                                        const result = await runtime.dbDeleteConnection({ alias });
                                        if (result?.profiles) setDbSavedConnections(result.profiles);
                                    } catch { /* */ }
                                }}
                                onSaveConnection={async (payload, previousAlias) => {
                                    if (!runtime?.dbSaveConnection) return;
                                    try {
                                        const result = await runtime.dbSaveConnection(payload);
                                        if (result?.profiles) setDbSavedConnections(result.profiles);
                                    } catch { /* */ }
                                }}
                                onCreateConnection={async (payload) => {
                                    if (!runtime?.dbSaveConnection) return;
                                    try {
                                        const result = await runtime.dbSaveConnection(payload);
                                        if (result?.profiles) setDbSavedConnections(result.profiles);
                                    } catch { /* */ }
                                }}
                                onRefreshConnections={refreshSavedConnections}
                                dbTabs={dbTabs} activeDbTabId={activeDbTabId}
                                onActivateDbTab={setActiveDbTabId}
                                onCloseDbTab={(id) => setDbTabs((prev) => prev.filter((t) => t.id !== id))}
                                onRefreshTables={refreshDatabaseTables}
                            />
                        ) : activeView === 'git' ? (
                            <GitWorkspacePanel />
                        ) : activeView === 'git-diff' ? (
                            <GitDiffPanel
                                filePath={gitDiffState.filePath}
                                original={gitDiffState.original}
                                modified={gitDiffState.modified}
                            />
                        ) : activeView === 'ai' ? (
                            <AiAssistantPanel />
                        ) : (
                            <EditorPanel
                                code={editorCode} onChangeCode={setEditorCode}
                                activeFilePath={activeFilePath}
                                openTabs={openTabs} activeTabId={activeTabId}
                                onActivateTab={setActiveTabId}
                                onCloseTab={(id) => setOpenTabs((current) => current.filter((t) => t.id !== id))}
                                onSaveActiveTab={() => { /* TODO */ }}
                                onModelMetricsUpdate={handleModelMetricsUpdate}
                                terminalHeightRatio={paneDimensions.terminalHeightRatio}
                                onTerminalHeightRatioChange={(v) => updatePaneDimensions({ terminalHeightRatio: v })}
                            />
                        )}
                    </section>

                    {chatVisible && (
                        <>
                            <div role="separator" aria-orientation="vertical" onMouseDown={startRightResize}
                                className="w-1 shrink-0 cursor-col-resize bg-transparent transition hover:bg-cyan-300/25"
                                title="Resize chat"
                            />
                            <section className="glass-chrome shrink-0 border-l" style={{ width: `${paneDimensions.rightChatWidth}px` }}>
                                <ChatPanel
                                    workspaceRoot={workspaceRoot}
                                    onApplyCode={handleApplyCode}
                                    onModelMetricsUpdate={handleModelMetricsUpdate}
                                />
                            </section>
                        </>
                    )}
                </main>

                <footer className="glass-chrome relative z-10 flex h-6 items-center justify-end border-t px-3 text-[11px] text-slate-300">
                    <div className="flex items-center gap-4">
                        <div className="min-w-[190px]">
                            <p className="mb-0.5 text-slate-400">VRAM: {(hardware.vramUsed / 1024).toFixed(1)} / {(hardware.vramTotal / 1024).toFixed(1)} GB</p>
                            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
                                <div className="h-full rounded-full bg-gradient-to-r from-cyan-300/80 to-teal-300/80" style={{ width: `${vramPercent}%` }} />
                            </div>
                        </div>
                        <p className="whitespace-nowrap text-slate-300">
                            {modelPerf.tokensPerSec.toFixed(1)} t/s | Context: {formatContext(modelPerf.contextUsed)}/{formatContext(modelPerf.contextTotal)}
                        </p>
                    </div>
                </footer>

                {bootstrapState.visible && (
                    <div className="absolute inset-0 z-50 grid place-items-center bg-slate-950/90 p-6 backdrop-blur-sm">
                        <div className="w-full max-w-lg rounded-2xl border border-cyan-300/25 bg-slate-900/95 p-5 shadow-glow">
                            <div className="mb-4 flex items-center gap-3">
                                <div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300/15">
                                    {bootstrapState.inProgress ? (
                                        <LoaderCircle className="h-5 w-5 animate-spin text-cyan-200" />
                                    ) : (
                                        <DownloadCloud className="h-5 w-5 text-cyan-200" />
                                    )}
                                </div>
                                <div>
                                    <h2 className="text-sm font-semibold tracking-[0.1em] text-cyan-100">PAL Runtime Setup</h2>
                                    <p className="text-xs text-slate-400">AppData/PalCode provisioning in progress</p>
                                </div>
                            </div>
                            <p className="mb-3 text-sm text-slate-200">{bootstrapState.label}</p>
                            <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                                <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-teal-300 transition-all duration-200" style={{ width: `${Math.max(0, Math.min(100, bootstrapState.percent))}%` }} />
                            </div>
                            <p className="mb-4 text-xs uppercase tracking-[0.08em] text-slate-400">{bootstrapState.stage} · {Math.max(0, Math.min(100, bootstrapState.percent))}%</p>
                            <div className="flex items-center justify-end gap-2">
                                {bootstrapState.inProgress ? (
                                    <button type="button" onClick={handleCancelBootstrap}
                                        className="rounded-lg border border-rose-300/35 bg-rose-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-rose-200 hover:bg-rose-300/20">
                                        Cancel
                                    </button>
                                ) : (
                                    <button type="button" disabled={!bootstrapState.canDismiss}
                                        onClick={() => setBootstrapState((current) => ({ ...current, visible: false }))}
                                        className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60">
                                        Continue
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </ThemeProvider>
    );
}

const root = createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
