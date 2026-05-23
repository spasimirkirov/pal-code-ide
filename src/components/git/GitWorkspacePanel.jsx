import React, { useEffect, useState } from 'react';
import { Files, GitBranch, RefreshCw } from 'lucide-react';

const runtime = window.palRuntime;

function GitWorkspacePanel() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState({
        isRepo: false,
        branch: '',
        staged: [],
        unstaged: [],
    });

    const refreshStatus = async () => {
        if (!runtime?.gitStatus) {
            return;
        }

        setLoading(true);
        setError('');
        try {
            const payload = await runtime.gitStatus();
            setStatus(
                payload || {
                    isRepo: false,
                    branch: '',
                    staged: [],
                    unstaged: [],
                },
            );
        } catch (nextError) {
            setError(nextError?.message || 'Failed to load git status.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refreshStatus();

        const onExternalRefresh = () => {
            void refreshStatus();
        };

        window.addEventListener('pal:git-refresh', onExternalRefresh);
        return () => {
            window.removeEventListener('pal:git-refresh', onExternalRefresh);
        };
    }, []);

    if (!status.isRepo) {
        return (
            <section className="flex h-full items-center justify-center bg-[#0f1319] p-4 text-center text-sm text-slate-400">
                Current workspace is not a git repository.
            </section>
        );
    }

    return (
        <section className="flex h-full flex-col bg-[#0f1319] p-4">
            <header className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.09em] text-cyan-100">Git Overview</h2>
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                        <GitBranch className="h-3.5 w-3.5" />
                        Branch: {status.branch || 'unknown'}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void refreshStatus()}
                    className="rounded-md border border-slate-700 bg-slate-900/80 p-1.5 text-slate-300 hover:text-cyan-100"
                    title="Refresh git overview"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </header>

            {error && <p className="mb-3 text-xs text-rose-300">{error}</p>}

            <div className="grid gap-3 md:grid-cols-2">
                <article className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Staged Files</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-100">{status.staged.length}</p>
                </article>
                <article className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Unstaged Files</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-100">{status.unstaged.length}</p>
                </article>
            </div>

            <div className="mt-4 rounded-lg border border-slate-700/80 bg-slate-900/60 p-4 text-sm text-slate-300">
                <p className="mb-2 flex items-center gap-2 font-medium text-slate-200">
                    <Files className="h-4 w-4 text-cyan-200" />
                    Source Control Sidebar
                </p>
                <p className="text-xs leading-relaxed text-slate-400">
                    Use the left Source Control panel to stage, unstage, revert files, and open diff previews. This center view gives a quick repository summary.
                </p>
            </div>
        </section>
    );
}

export default GitWorkspacePanel;
