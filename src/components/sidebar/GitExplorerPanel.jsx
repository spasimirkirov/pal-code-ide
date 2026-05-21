import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, GitCommitHorizontal, LoaderCircle, Minus, Plus, RefreshCw, RotateCcw } from 'lucide-react';

const runtime = window.palRuntime;

function GitFileList({ title, files, kind, actionBusyPath, onOpenDiff, onStage, onUnstage, onRevert }) {
    return (
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-2">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">{title}</h4>
            {files.length === 0 ? (
                <p className="text-xs text-slate-500">No files</p>
            ) : (
                <ul className="space-y-1">
                    {files.map((file) => (
                        <li key={`${title}-${file.path}`} className="flex items-center justify-between rounded-md bg-slate-800/80 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700/80">
                            <button
                                type="button"
                                onClick={() => onOpenDiff?.(file.path)}
                                className="min-w-0 flex-1 truncate text-left"
                            >
                                {file.path}
                            </button>
                            <span className="ml-2 flex shrink-0 items-center gap-1">
                                {kind === 'unstaged' ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onStage?.(file.path);
                                            }}
                                            className="text-slate-400 opacity-70 transition-all hover:text-white hover:opacity-100"
                                            title="Stage file"
                                        >
                                            {actionBusyPath === file.path ? (
                                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Plus className="h-3.5 w-3.5" />
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onRevert?.(file.path);
                                            }}
                                            className="text-slate-400 opacity-70 transition-all hover:text-white hover:opacity-100"
                                            title="Revert changes"
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onUnstage?.(file.path);
                                        }}
                                        className="text-slate-400 opacity-70 transition-all hover:text-white hover:opacity-100"
                                        title="Unstage file"
                                    >
                                        {actionBusyPath === file.path ? (
                                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Minus className="h-3.5 w-3.5" />
                                        )}
                                    </button>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function GitExplorerPanel({ onOpenDiff }) {
    const [status, setStatus] = useState({
        isRepo: false,
        branch: null,
        staged: [],
        unstaged: [],
    });
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [actionBusyPath, setActionBusyPath] = useState('');
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const refreshStatus = async () => {
        if (!runtime?.gitStatus) {
            return;
        }

        setLoading(true);
        setError('');

        try {
            const nextStatus = await runtime.gitStatus();
            setStatus(nextStatus || { isRepo: false, branch: null, staged: [], unstaged: [] });
        } catch (nextError) {
            setError(nextError?.message || 'Failed to load git status.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refreshStatus();

        const handleExternalRefresh = () => {
            void refreshStatus();
        };

        window.addEventListener('pal:git-refresh', handleExternalRefresh);

        return () => {
            window.removeEventListener('pal:git-refresh', handleExternalRefresh);
        };
    }, []);

    const hasChanges = useMemo(
        () => status.staged.length > 0 || status.unstaged.length > 0,
        [status.staged.length, status.unstaged.length],
    );

    const handleAiCommit = async () => {
        setAiLoading(true);
        setInfo('');
        await new Promise((resolve) => setTimeout(resolve, 1200));
        setInfo('AI Commit summary mock complete. Qwen integration pending.');
        setAiLoading(false);
    };

    const handleCommit = async () => {
        if (!message.trim()) {
            setError('Please provide a commit message.');
            return;
        }

        setLoading(true);
        setError('');
        setInfo('');

        try {
            await runtime.gitCommit({ message });
            setInfo('Commit completed successfully.');
            setMessage('');
            await refreshStatus();
        } catch (nextError) {
            setError(nextError?.message || 'Commit failed.');
        } finally {
            setLoading(false);
        }
    };

    const handleStageFile = async (filePath) => {
        setActionBusyPath(filePath);
        setError('');
        try {
            await runtime.gitStageFile({ filePath });
            await refreshStatus();
        } catch (nextError) {
            setError(nextError?.message || 'Failed to stage file.');
        } finally {
            setActionBusyPath('');
        }
    };

    const handleUnstageFile = async (filePath) => {
        setActionBusyPath(filePath);
        setError('');
        try {
            await runtime.gitUnstageFile({ filePath });
            await refreshStatus();
        } catch (nextError) {
            setError(nextError?.message || 'Failed to unstage file.');
        } finally {
            setActionBusyPath('');
        }
    };

    const handleRevertFile = async (filePath) => {
        setActionBusyPath(filePath);
        setError('');
        try {
            await runtime.gitRevertFile({ filePath });
            await refreshStatus();
        } catch (nextError) {
            setError(nextError?.message || 'Failed to revert file.');
        } finally {
            setActionBusyPath('');
        }
    };

    if (!status.isRepo) {
        return (
            <section className="flex h-full items-center justify-center p-4 text-center text-xs text-slate-500">
                This workspace is not a git repository.
            </section>
        );
    }

    return (
        <section className="flex h-full flex-col p-3">
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-300">Source Control</h3>
                    <p className="text-[11px] text-slate-500">Branch: {status.branch || 'unknown'}</p>
                </div>
                <button
                    type="button"
                    onClick={() => void refreshStatus()}
                    className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-1.5 text-slate-300 hover:text-cyan-100"
                    title="Refresh status"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="mb-2 flex items-center gap-2">
                <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Commit message"
                    className="flex-1 rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-300/45"
                />
                <button
                    type="button"
                    onClick={() => void handleAiCommit()}
                    disabled={aiLoading}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-300/20 disabled:opacity-60"
                >
                    {aiLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <GitCommitHorizontal className="h-3.5 w-3.5" />}
                    AI Commit
                </button>
            </div>

            <button
                type="button"
                disabled={!hasChanges || loading}
                onClick={() => void handleCommit()}
                className="mb-3 inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/12 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
            >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Commit Changes
            </button>

            {error && <p className="mb-2 text-xs text-rose-300">{error}</p>}
            {info && <p className="mb-2 text-xs text-emerald-300">{info}</p>}

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                <GitFileList
                    title="Staged"
                    files={status.staged}
                    kind="staged"
                    actionBusyPath={actionBusyPath}
                    onOpenDiff={onOpenDiff}
                    onUnstage={handleUnstageFile}
                />
                <GitFileList
                    title="Unstaged"
                    files={status.unstaged}
                    kind="unstaged"
                    actionBusyPath={actionBusyPath}
                    onOpenDiff={onOpenDiff}
                    onStage={handleStageFile}
                    onRevert={handleRevertFile}
                />
            </div>
        </section>
    );
}

export default GitExplorerPanel;
