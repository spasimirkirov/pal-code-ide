import React, { useMemo, useState } from 'react';
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { Database, LoaderCircle, Plus, Trash2, X } from 'lucide-react';

const runtime = window.palRuntime;

function AddRowModal({ open, onClose, onSubmit, columns, busy }) {
    const [values, setValues] = useState({});

    if (!open) {
        return null;
    }

    const handleSubmit = (event) => {
        event.preventDefault();
        const payload = Object.entries(values).reduce((acc, [key, value]) => {
            if (String(value || '').trim().length) {
                acc[key] = value;
            }
            return acc;
        }, {});

        onSubmit(payload);
    };

    return (
        <div className="absolute inset-0 z-20 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
            <form
                onSubmit={handleSubmit}
                className="w-full max-w-2xl rounded-2xl border border-slate-700/70 bg-slate-900 p-4"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-200">Insert Row</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-slate-700/70 bg-slate-800/80 p-1 text-slate-300 hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="grid max-h-[55vh] grid-cols-1 gap-2 overflow-auto pr-1 md:grid-cols-2">
                    {columns.map((column) => (
                        <label key={column.name} className="space-y-1">
                            <span className="text-xs text-slate-400">{column.name}</span>
                            <input
                                value={values[column.name] ?? ''}
                                onChange={(event) =>
                                    setValues((current) => ({
                                        ...current,
                                        [column.name]: event.target.value,
                                    }))
                                }
                                className="w-full rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-300/45"
                            />
                        </label>
                    ))}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/12 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
                    >
                        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        Insert Row
                    </button>
                </div>
            </form>
        </div>
    );
}

function DatabaseViewerPanel({ tableName }) {
    const [rows, setRows] = useState([]);
    const [columnsMeta, setColumnsMeta] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [inserting, setInserting] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);

    const loadRows = async () => {
        if (!runtime?.dbFetchRows || !tableName) {
            return;
        }

        setLoading(true);
        setError('');
        try {
            const response = await runtime.dbFetchRows({ table: tableName });
            setRows(Array.isArray(response?.rows) ? response.rows : []);
            setColumnsMeta(Array.isArray(response?.columns) ? response.columns : []);
        } catch (nextError) {
            setError(nextError?.message || 'Failed to load table rows.');
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => {
        void loadRows();
    }, [tableName]);

    const columns = useMemo(() => {
        const baseColumns = columnsMeta.map((column) => ({
            header: column.name,
            accessorKey: column.name,
            cell: (info) => {
                const value = info.getValue();
                if (value === null || value === undefined) {
                    return <span className="text-slate-500">null</span>;
                }
                return String(value);
            },
        }));

        return [
            ...baseColumns,
            {
                id: '_actions',
                header: 'Actions',
                cell: ({ row }) => {
                    const id = row.original?.id;
                    const disabled = id === undefined || id === null || deletingId === id;
                    return (
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={async () => {
                                if (id === undefined || id === null) {
                                    return;
                                }

                                setDeletingId(id);
                                setError('');
                                try {
                                    await runtime.dbDeleteRow({ table: tableName, id });
                                    await loadRows();
                                } catch (nextError) {
                                    setError(nextError?.message || 'Failed to delete row.');
                                } finally {
                                    setDeletingId(null);
                                }
                            }}
                            className="inline-flex items-center justify-center rounded-md border border-rose-300/35 bg-rose-300/10 p-1 text-rose-200 hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-60"
                            title={disabled ? 'Requires id column' : 'Delete row'}
                        >
                            {deletingId === id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                    );
                },
            },
        ];
    }, [columnsMeta, deletingId, tableName]);

    const table = useReactTable({
        data: rows,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    const handleInsertRow = async (payload) => {
        setInserting(true);
        setError('');
        try {
            await runtime.dbInsertRow({
                table: tableName,
                row: payload,
            });
            setModalOpen(false);
            await loadRows();
        } catch (nextError) {
            setError(nextError?.message || 'Insert row failed.');
        } finally {
            setInserting(false);
        }
    };

    if (!tableName) {
        return (
            <div className="flex h-full items-center justify-center bg-[#0f1319] text-sm text-slate-400">
                Select a table from Database Explorer.
            </div>
        );
    }

    return (
        <div className="relative flex h-full flex-col overflow-hidden bg-[#0f1319]">
            <div className="flex h-8 items-center justify-between border-b border-slate-800 px-3">
                <div className="flex items-center gap-2 text-cyan-100">
                    <Database className="h-4 w-4" />
                    <h2 className="text-xs font-semibold tracking-[0.08em]">Database Viewer</h2>
                </div>
                <div className="flex items-center gap-2">
                    <div className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2 py-1 text-xs text-slate-300">
                        {tableName}
                    </div>
                    <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300/35 bg-emerald-300/12 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/20"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add Row
                    </button>
                    <button
                        type="button"
                        onClick={() => void loadRows()}
                        className="rounded-lg border border-slate-700/70 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 hover:text-cyan-100"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {error && <p className="px-4 py-2 text-xs text-rose-300">{error}</p>}

            <div className="min-h-0 flex-1 overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-900/95">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <th
                                        key={header.id}
                                        className="border-b border-edge px-3 py-2 text-left font-semibold uppercase tracking-[0.08em] text-slate-400"
                                    >
                                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-500">
                                    Loading rows...
                                </td>
                            </tr>
                        ) : table.getRowModel().rows.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-500">
                                    No rows returned.
                                </td>
                            </tr>
                        ) : (
                            table.getRowModel().rows.map((row) => (
                                <tr key={row.id} className="odd:bg-slate-900/30 even:bg-slate-900/55">
                                    {row.getVisibleCells().map((cell) => (
                                        <td key={cell.id} className="max-w-[320px] border-b border-edge/40 px-3 py-2 text-slate-200">
                                            <div className="truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <AddRowModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                onSubmit={(payload) => {
                    void handleInsertRow(payload);
                }}
                columns={columnsMeta}
                busy={inserting}
            />
        </div>
    );
}

export default DatabaseViewerPanel;
