import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Database, Link2, LoaderCircle, RefreshCw, Table2 } from 'lucide-react';

const runtime = window.palRuntime;

const defaultConfig = {
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: '',
    port: 3306,
};

function DatabaseExplorerPanel({ onOpenTable }) {
    const [config, setConfig] = useState(defaultConfig);
    const [tables, setTables] = useState([]);
    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [loadingTables, setLoadingTables] = useState(false);
    const [error, setError] = useState('');
    const [formExpanded, setFormExpanded] = useState(true);

    const updateField = (key, value) => {
        setConfig((current) => ({
            ...current,
            [key]: value,
        }));
    };

    const refreshTables = async () => {
        if (!runtime?.databaseGetTables) {
            return;
        }

        setLoadingTables(true);
        setError('');
        try {
            const response = await runtime.databaseGetTables();
            setTables(Array.isArray(response?.tables) ? response.tables : []);
        } catch (nextError) {
            setError(nextError?.message || 'Failed to load database tables.');
        } finally {
            setLoadingTables(false);
        }
    };

    const handleConnect = async (event) => {
        event.preventDefault();
        if (!runtime?.databaseConnect) {
            return;
        }

        setConnecting(true);
        setError('');
        try {
            await runtime.databaseConnect({
                host: config.host,
                user: config.user,
                password: config.password,
                database: config.database,
                port: Number(config.port || 3306),
            });
            setConnected(true);
            await refreshTables();
            setFormExpanded(false);
        } catch (nextError) {
            setConnected(false);
            setError(nextError?.message || 'Unable to connect to MySQL.');
        } finally {
            setConnecting(false);
        }
    };

    const statusText = useMemo(() => {
        if (connected) {
            return `Connected to ${config.database || 'database'}`;
        }
        return 'Not connected';
    }, [connected, config.database]);

    return (
        <section className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-300">Database Explorer</h3>
                    <p className="text-[11px] text-slate-500">{statusText}</p>
                </div>
                <button
                    type="button"
                    onClick={() => setFormExpanded((value) => !value)}
                    className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-1.5 text-slate-300 hover:text-cyan-100"
                    title={formExpanded ? 'Collapse connection form' : 'Expand connection form'}
                >
                    {formExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
            </div>

            {formExpanded && (
                <form onSubmit={handleConnect} className="space-y-2 border-b border-edge p-3">
                    <input
                        value={config.host}
                        onChange={(event) => updateField('host', event.target.value)}
                        placeholder="Host"
                        className="w-full rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-300/45"
                    />
                    <input
                        value={config.port}
                        onChange={(event) => updateField('port', event.target.value)}
                        placeholder="Port"
                        className="w-full rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-300/45"
                    />
                    <input
                        value={config.user}
                        onChange={(event) => updateField('user', event.target.value)}
                        placeholder="User"
                        className="w-full rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-300/45"
                    />
                    <input
                        value={config.password}
                        type="password"
                        onChange={(event) => updateField('password', event.target.value)}
                        placeholder="Password"
                        className="w-full rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-300/45"
                    />
                    <input
                        value={config.database}
                        onChange={(event) => updateField('database', event.target.value)}
                        placeholder="Database"
                        className="w-full rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-300/45"
                    />

                    <button
                        type="submit"
                        disabled={connecting}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/12 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
                    >
                        {connecting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                        {connecting ? 'Connecting...' : 'Connect'}
                    </button>
                </form>
            )}

            {error && <p className="px-3 py-2 text-xs text-rose-300">{error}</p>}

            <div className="flex items-center justify-between px-3 py-2">
                <p className="text-xs uppercase tracking-[0.1em] text-slate-400">Tables</p>
                <button
                    type="button"
                    disabled={!connected || loadingTables}
                    onClick={() => void refreshTables()}
                    className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-1.5 text-slate-300 hover:text-cyan-100 disabled:opacity-60"
                    title="Refresh tables"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingTables ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {tables.length === 0 ? (
                    <div className="grid h-full place-items-center rounded-xl border border-dashed border-slate-700/70 bg-slate-900/35 p-4 text-center text-xs text-slate-500">
                        <div>
                            <Database className="mx-auto mb-2 h-4 w-4" />
                            Connect to a MySQL database to discover tables.
                        </div>
                    </div>
                ) : (
                    <ul className="space-y-1">
                        {tables.map((tableName) => (
                            <li key={tableName}>
                                <button
                                    type="button"
                                    onClick={() => onOpenTable?.(tableName)}
                                    className="flex w-full items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/70 px-2 py-2 text-left text-xs text-slate-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/10"
                                >
                                    <Table2 className="h-3.5 w-3.5 text-cyan-200" />
                                    <span className="truncate">{tableName}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

export default DatabaseExplorerPanel;
