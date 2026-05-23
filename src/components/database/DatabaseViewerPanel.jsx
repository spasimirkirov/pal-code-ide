import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box, Typography, Button, IconButton, Tooltip, TextField, Select, MenuItem,
    Chip, Dialog, DialogTitle, DialogContent, DialogActions, Switch, FormControlLabel,
    Paper, Divider, InputAdornment, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Checkbox, FormControl, InputLabel,
} from '@mui/material';
import {
    Database, Plug, PlugZap, Unplug, Plus, Minus, X, RefreshCw, Download,
    ChevronLeft, ChevronRight, Play, Terminal, Table2, Trash2,
    CheckCircle2, Undo2, LoaderCircle, ArrowUpDown, ArrowUp, ArrowDown,
    Key,
} from 'lucide-react';

const runtime = window.palRuntime;

const stripMeta = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (!key.startsWith('__')) result[key] = value;
    }
    return result;
};

const toCsv = (rows, columns) => {
    const headers = columns.map((c) => {
        const val = String(c.name || '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
            ? `"${val.replace(/"/g, '""')}"` : val;
    });
    const lines = [headers.join(',')];
    for (const row of rows) {
        const vals = columns.map((c) => {
            const raw = row[c.name];
            if (raw === null || raw === undefined) return '';
            const val = String(raw);
            return val.includes(',') || val.includes('"') || val.includes('\n')
                ? `"${val.replace(/"/g, '""')}"` : val;
        });
        lines.push(vals.join(','));
    }
    return lines.join('\n');
};

const TYPE_COLORS = {
    int: '#f59e0b', integer: '#f59e0b', bigint: '#f59e0b', smallint: '#f59e0b', tinyint: '#f59e0b',
    varchar: '#38bdf8', char: '#38bdf8', text: '#38bdf8', mediumtext: '#38bdf8', longtext: '#38bdf8',
    float: '#a78bfa', double: '#a78bfa', decimal: '#a78bfa', numeric: '#a78bfa', real: '#a78bfa',
    date: '#34d399', datetime: '#34d399', timestamp: '#34d399', time: '#34d399', year: '#34d399',
    blob: '#f472b6', binary: '#f472b6', varbinary: '#f472b6',
    bool: '#fb923c', boolean: '#fb923c',
};

const getTypeColor = (type) => {
    if (!type) return '#94a3b8';
    const t = String(type).toLowerCase();
    for (const [key, color] of Object.entries(TYPE_COLORS)) {
        if (t.startsWith(key)) return color;
    }
    return '#94a3b8';
};

const NEW_CONN_DEFAULTS = {
    driver: 'mysql', host: 'localhost', port: '3306', user: 'root',
    password: '', database: '', sqlitePath: '', alias: '',
};

function ConnectionEditModal({ open, initial, onSave, onClose }) {
    const isEdit = !!initial?.alias;
    const d = isEdit ? initial : NEW_CONN_DEFAULTS;
    const [driver, setDriver] = useState(d.driver);
    const [alias, setAlias] = useState(d.alias || '');
    const [host, setHost] = useState(d.host);
    const [port, setPort] = useState(String(d.port));
    const [user, setUser] = useState(d.user);
    const [password, setPassword] = useState(d.password);
    const [database, setDatabase] = useState(d.database);
    const [sqlitePath, setSqlitePath] = useState(d.sqlitePath);

    useEffect(() => {
        if (!open) return;
        const src = initial?.alias ? initial : NEW_CONN_DEFAULTS;
        setDriver(src.driver);
        setAlias(src.alias || '');
        setHost(src.host);
        setPort(String(src.port));
        setUser(src.user);
        setPassword(src.password);
        setDatabase(src.database);
        setSqlitePath(src.sqlitePath);
    }, [open, initial]);

    const handleSave = () => {
        if (!alias.trim()) return;
        onSave({
            driver, alias: alias.trim(),
            host: driver === 'mysql' ? host.trim() : '',
            port: driver === 'mysql' ? (Number(port) || 3306) : 0,
            user: driver === 'mysql' ? user.trim() : '',
            password: driver === 'mysql' ? password : '',
            database: driver === 'mysql' ? database.trim() : '',
            sqlitePath: driver === 'sqlite' ? sqlitePath.trim() : '',
        });
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
            PaperProps={{ sx: { bgcolor: '#0d1225', border: '1px solid', borderColor: 'divider' } }}>
            <DialogTitle sx={{ color: 'primary.light', fontSize: 14, pb: 1 }}>
                {isEdit ? 'Edit Connection' : 'New Connection'}
            </DialogTitle>
            <DialogContent sx={{ pt: '8px !important' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 0.5 }}>
                    <FormControl size="small" fullWidth>
                        <InputLabel sx={{ color: 'text.secondary', fontSize: 12 }}>Driver</InputLabel>
                        <Select
                            value={driver} label="Driver"
                            onChange={(e) => setDriver(e.target.value)}
                            sx={{ fontSize: 12, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' } }}
                        >
                            <MenuItem value="mysql" sx={{ fontSize: 12 }}>MySQL</MenuItem>
                            <MenuItem value="sqlite" sx={{ fontSize: 12 }}>SQLite</MenuItem>
                        </Select>
                    </FormControl>
                    <TextField size="small" label="Alias" value={alias} onChange={(e) => setAlias(e.target.value)}
                        sx={{ '& .MuiInputLabel-root': { fontSize: 12 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' } }}
                        slotProps={{ input: { sx: { fontSize: 12 } } }} />
                    {driver === 'mysql' ? (
                        <>
                            <TextField size="small" label="Host" value={host} onChange={(e) => setHost(e.target.value)}
                                sx={{ '& .MuiInputLabel-root': { fontSize: 12 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' } }}
                                slotProps={{ input: { sx: { fontSize: 12 } } }} />
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <TextField size="small" label="Port" value={port} onChange={(e) => setPort(e.target.value)}
                                    sx={{ width: 120, '& .MuiInputLabel-root': { fontSize: 12 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' } }}
                                    slotProps={{ input: { sx: { fontSize: 12 } } }} />
                                <TextField size="small" label="User" value={user} onChange={(e) => setUser(e.target.value)}
                                    sx={{ flex: 1, '& .MuiInputLabel-root': { fontSize: 12 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' } }}
                                    slotProps={{ input: { sx: { fontSize: 12 } } }} />
                            </Box>
                            <TextField size="small" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                                sx={{ '& .MuiInputLabel-root': { fontSize: 12 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' } }}
                                slotProps={{ input: { sx: { fontSize: 12 } } }} />
                            <TextField size="small" label="Database" value={database} onChange={(e) => setDatabase(e.target.value)}
                                sx={{ '& .MuiInputLabel-root': { fontSize: 12 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' } }}
                                slotProps={{ input: { sx: { fontSize: 12 } } }} />
                        </>
                    ) : (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                            <TextField size="small" label="SQLite File Path" value={sqlitePath} onChange={(e) => setSqlitePath(e.target.value)}
                                sx={{ flex: 1, '& .MuiInputLabel-root': { fontSize: 12 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' } }}
                                slotProps={{ input: { sx: { fontSize: 12 } } }} />
                            <Button size="small" variant="outlined" onClick={async () => {
                                const path = await runtime?.dbBrowseSqlite?.();
                                if (path) setSqlitePath(path);
                            }}
                                sx={{ mt: 0.5, fontSize: 10, minWidth: 60, borderColor: 'rgba(43,209,255,0.3)', color: 'primary.light' }}>
                                Browse
                            </Button>
                        </Box>
                    )}
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 2, pb: 2 }}>
                <Button onClick={onClose} size="small" sx={{ color: 'text.secondary', fontSize: 11 }}>Cancel</Button>
                <Button onClick={handleSave} size="small" variant="outlined" disabled={!alias.trim()}
                    sx={{ fontSize: 11, borderColor: 'rgba(43,209,255,0.3)', color: 'primary.light' }}>
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function ApplyModal({ open, summary, onApply, onClose }) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs"
            PaperProps={{ sx: { bgcolor: '#0d1225', border: '1px solid', borderColor: 'divider' } }}>
            <DialogTitle sx={{ color: 'primary.light', fontSize: 14 }}>Apply Changes</DialogTitle>
            <DialogContent sx={{ pt: '8px !important' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12, mb: 1 }}>
                    This will apply the following pending changes:
                </Typography>
                {summary.inserts > 0 && <Typography variant="caption" sx={{ display: 'block', color: '#22c55e', fontSize: 11 }}>{summary.inserts} insert(s)</Typography>}
                {summary.updates > 0 && <Typography variant="caption" sx={{ display: 'block', color: '#facc15', fontSize: 11 }}>{summary.updates} update(s)</Typography>}
                {summary.deletes > 0 && <Typography variant="caption" sx={{ display: 'block', color: '#ef4444', fontSize: 11 }}>{summary.deletes} delete(s)</Typography>}
            </DialogContent>
            <DialogActions sx={{ px: 2, pb: 2 }}>
                <Button onClick={onClose} size="small" sx={{ color: 'text.secondary', fontSize: 11 }}>Cancel</Button>
                <Button onClick={onApply} size="small" variant="outlined" color="error"
                    sx={{ fontSize: 11, borderColor: 'rgba(239,68,68,0.3)' }}>
                    Apply
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function PendingChangesBar({ summary, onRevert, onApply }) {
    const hasPending = summary.inserts > 0 || summary.updates > 0 || summary.deletes > 0;
    if (!hasPending) return null;
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'rgba(13,18,37,0.8)' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                Pending:
            </Typography>
            {summary.inserts > 0 && <Chip label={`+${summary.inserts} ins`} size="small" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(34,197,94,0.12)', color: '#22c55e', '& .MuiChip-label': { px: 0.75 } }} />}
            {summary.updates > 0 && <Chip label={`~${summary.updates} upd`} size="small" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(250,204,21,0.12)', color: '#facc15', '& .MuiChip-label': { px: 0.75 } }} />}
            {summary.deletes > 0 && <Chip label={`-${summary.deletes} del`} size="small" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(239,68,68,0.12)', color: '#ef4444', '& .MuiChip-label': { px: 0.75 } }} />}
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={onRevert} startIcon={<Undo2 size={12} />}
                sx={{ fontSize: 10, minWidth: 0, py: 0.25, color: 'text.secondary', '&:hover': { color: 'warning.light' } }}>
                Revert
            </Button>
            <Button size="small" onClick={onApply} startIcon={<CheckCircle2 size={12} />}
                sx={{ fontSize: 10, minWidth: 0, py: 0.25, color: '#22c55e', '&:hover': { color: '#4ade80' } }}>
                Apply
            </Button>
        </Box>
    );
}

function DataTable({ columns, rows, baseRows, selectedKeys, onToggleSelect, onToggleSelectAll,
    editingCell, onStartEdit, onCommitEdit, onCancelEdit, onInsertRow, onDeleteRow, sortColumn, sortDirection, onSort }) {

    const allSelected = rows.length > 0 && rows.every((r) => selectedKeys.has(r.__rowKey));

    const getCellValue = (row, colName) => {
        if (editingCell && editingCell.rowKey === row.__rowKey && editingCell.column === colName) {
            return editingCell.value;
        }
        return row[colName];
    };

    return (
        <TableContainer component={Paper} variant="outlined"
            sx={{ flex: 1, overflow: 'auto', bgcolor: 'transparent', border: 'none', borderRadius: 1 }}>
            <Table size="small" stickyHeader sx={{ minWidth: '100%', tableLayout: 'auto' }}>
                <TableHead>
                    <TableRow>
                        <TableCell padding="checkbox" sx={{ bgcolor: 'rgba(13,18,37,0.95)', borderBottom: '1px solid', borderColor: 'divider', width: 36 }}>
                            <Checkbox
                                size="small"
                                checked={allSelected}
                                indeterminate={selectedKeys.size > 0 && !allSelected}
                                onChange={onToggleSelectAll}
                                sx={{ color: 'text.disabled', '&.Mui-checked': { color: 'primary.light' } }}
                            />
                        </TableCell>
                        {columns.map((col) => {
                            const isSorted = sortColumn === col.name;
                            const typeColor = getTypeColor(col.type);
                            return (
                                <TableCell
                                    key={col.name}
                                    onClick={() => onSort(col.name)}
                                    sx={{
                                        bgcolor: 'rgba(13,18,37,0.95)', borderBottom: '1px solid', borderColor: 'divider',
                                        color: 'text.primary', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                        whiteSpace: 'nowrap', py: 1, userSelect: 'none',
                                        '&:hover': { bgcolor: 'rgba(43,209,255,0.05)' },
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>
                                            {col.name}
                                        </Typography>
                                        <Tooltip title={`${String(col.type || '').toUpperCase()}${col.key === 'PRI' ? ' · PRIMARY KEY' : ''}`} arrow placement="top">
                                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                                                {col.key === 'PRI' && <Key size={9} style={{ color: '#facc15' }} />}
                                                <Typography variant="caption" sx={{ fontSize: 9, color: typeColor, opacity: 0.8 }}>
                                                    {String(col.type || '').toLowerCase()}
                                                </Typography>
                                            </Box>
                                        </Tooltip>
                                        {isSorted ? (
                                            sortDirection === 'asc' ? <ArrowUp size={11} style={{ opacity: 0.7 }} /> : <ArrowDown size={11} style={{ opacity: 0.7 }} />
                                        ) : (
                                            <ArrowUpDown size={10} style={{ opacity: 0.3 }} />
                                        )}
                                    </Box>
                                </TableCell>
                            );
                        })}
                        <TableCell padding="checkbox" sx={{ bgcolor: 'rgba(13,18,37,0.95)', borderBottom: '1px solid', borderColor: 'divider', width: 40 }} />
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map((row) => {
                        const isSelected = selectedKeys.has(row.__rowKey);
                        const isNew = row.__isNew;
                        const isDeleted = row.__deleted;
                        return (
                            <TableRow
                                key={row.__rowKey}
                                hover
                                selected={isSelected}
                                onContextMenu={(e) => { e.preventDefault(); if (!isNew) onDeleteRow?.(row.__rowKey); }}
                                sx={{
                                    '&:hover': { bgcolor: 'rgba(148,163,184,0.04)' },
                                    '&.Mui-selected': { bgcolor: 'rgba(43,209,255,0.06)' },
                                    opacity: isDeleted ? 0.4 : 1,
                                    textDecoration: isDeleted ? 'line-through' : 'none',
                                    bgcolor: isNew ? 'rgba(34,197,94,0.04)' : 'transparent',
                                }}
                            >
                                <TableCell padding="checkbox" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                    <Checkbox
                                        size="small"
                                        checked={isSelected}
                                        onChange={() => onToggleSelect(row.__rowKey)}
                                        sx={{ color: 'text.disabled', '&.Mui-checked': { color: 'primary.light' } }}
                                    />
                                </TableCell>
                                {columns.map((col) => {
                                    const isEditing = editingCell && editingCell.rowKey === row.__rowKey && editingCell.column === col.name;
                                    return (
                                        <TableCell
                                            key={col.name}
                                            onDoubleClick={() => !isDeleted && onStartEdit(row.__rowKey, col.name, row[col.name])}
                                            sx={{
                                                borderBottom: '1px solid', borderColor: 'divider',
                                                fontSize: 11, fontFamily: '"JetBrains Mono", monospace',
                                                maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap', p: '4px 8px', cursor: isDeleted ? 'default' : 'cell',
                                                bgcolor: isEditing ? 'rgba(43,209,255,0.08)' : 'transparent',
                                            }}
                                        >
                                            {isEditing ? (
                                                <TextField
                                                    size="small"
                                                    autoFocus
                                                    fullWidth
                                                    value={editingCell.value ?? ''}
                                                    onChange={(e) => onCommitEdit(e.target.value, true)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') onCommitEdit(editingCell.value, false);
                                                        if (e.key === 'Escape') onCancelEdit();
                                                    }}
                                                    onBlur={() => onCommitEdit(editingCell.value, false)}
                                                    sx={{ '& .MuiOutlinedInput-notchedOutline': { borderColor: 'primary.light' } }}
                                                    slotProps={{ input: { sx: { fontSize: 11, py: 0, fontFamily: '"JetBrains Mono", monospace' } } }}
                                                />
                                            ) : (
                                                <Typography variant="caption" sx={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace', color: row[col.name] === null ? 'text.disabled' : 'text.primary' }}>
                                                    {row[col.name] === null ? <Box component="span" sx={{ fontStyle: 'italic', opacity: 0.4 }}>NULL</Box> : String(row[col.name])}
                                                </Typography>
                                            )}
                                        </TableCell>
                                    );
                                })}
                                <TableCell padding="checkbox" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                    {!isNew && (
                                        <Tooltip title="Delete row" arrow placement="left">
                                            <IconButton size="small" onClick={() => onDeleteRow(row.__rowKey)}
                                                sx={{ width: 22, height: 22, color: 'text.disabled', '&:hover': { color: 'error.light' } }}>
                                                <Minus size={12} />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                    <TableRow>
                        <TableCell colSpan={columns.length + 2}
                            onClick={onInsertRow}
                            sx={{
                                borderBottom: 'none', cursor: 'pointer', textAlign: 'center', py: 0.75,
                                '&:hover': { bgcolor: 'rgba(43,209,255,0.04)' },
                            }}>
                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                <Plus size={12} /> Click to add a new row
                            </Typography>
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </TableContainer>
    );
}

function SqlQueryTab({ columns, rows, loading, onRun, onOpenTableFromSql }) {
    const [sql, setSql] = useState('SELECT * FROM ');
    const [error, setError] = useState('');

    const handleRun = async () => {
        if (!sql.trim()) return;
        setError('');
        try {
            await onRun(sql);
        } catch (e) {
            setError(e?.message || 'Query failed');
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                    size="small"
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={6}
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    placeholder="Enter SQL query... Only SELECT, PRAGMA, and EXPLAIN are allowed."
                    slotProps={{
                        input: {
                            sx: {
                                fontSize: 12, fontFamily: '"JetBrains Mono", monospace',
                                bgcolor: 'rgba(13,18,37,0.6)',
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
                            },
                        },
                    }}
                />
                <Tooltip title="Run query" arrow>
                    <IconButton onClick={() => void handleRun()} disabled={loading || !sql.trim()}
                        sx={{ mt: 0.5, color: 'primary.light', border: '1px solid', borderColor: 'rgba(43,209,255,0.3)', borderRadius: 1, width: 36, height: 36 }}>
                        {loading ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
                    </IconButton>
                </Tooltip>
            </Box>
            {error && <Typography variant="caption" sx={{ color: 'error.light', fontSize: 11 }}>{error}</Typography>}
            {columns.length > 0 && (
                <TableContainer component={Paper} variant="outlined"
                    sx={{ flex: 1, overflow: 'auto', bgcolor: 'transparent', border: 'none' }}>
                    <Table size="small" stickyHeader sx={{ minWidth: '100%' }}>
                        <TableHead>
                            <TableRow>
                                {columns.map((col) => (
                                    <TableCell key={col.name}
                                        sx={{ bgcolor: 'rgba(13,18,37,0.95)', borderBottom: '1px solid', borderColor: 'divider', color: 'text.secondary', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: '"JetBrains Mono", monospace' }}>
                                        {col.name}
                                    </TableCell>
                                ))}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row, idx) => (
                                <TableRow key={idx} hover sx={{ '&:hover': { bgcolor: 'rgba(148,163,184,0.04)' } }}>
                                    {columns.map((col) => (
                                        <TableCell key={col.name}
                                            sx={{ borderBottom: '1px solid', borderColor: 'divider', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', p: '3px 8px' }}>
                                            {row[col.name] === null ? <Box component="span" sx={{ fontStyle: 'italic', opacity: 0.4 }}>NULL</Box> : String(row[col.name])}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                            {rows.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={columns.length} sx={{ textAlign: 'center', py: 3, borderBottom: 'none' }}>
                                        <Typography variant="caption" sx={{ color: 'text.disabled' }}>No results</Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
}

function DatabaseViewerPanel({
    connected = false, activeDatabase = '', tables = [], savedConnections: parentSavedConnections,
    onConnectConnection, onDisconnect, onDeleteConnection, onSaveConnection, onCreateConnection, onRefreshConnections,
    dbTabs = [], activeDbTabId, onActivateDbTab, onCloseDbTab, onRefreshTables,
}) {
    const [columns, setColumns] = useState([]);
    const [allColumns, setAllColumns] = useState([]);
    const [rows, setRows] = useState([]);
    const [baseRows, setBaseRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(100);
    const [totalCount, setTotalCount] = useState(0);
    const [sortColumn, setSortColumn] = useState(null);
    const [sortDirection, setSortDirection] = useState('asc');

    const [selectedKeys, setSelectedKeys] = useState(new Set());
    const [editingCell, setEditingCell] = useState(null);
    const [filterText, setFilterText] = useState('');

    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState(null);
    const [applyModalOpen, setApplyModalOpen] = useState(false);

    const [sqlTab, setSqlTab] = useState(false);
    const [sqlColumns, setSqlColumns] = useState([]);
    const [sqlRows, setSqlRows] = useState([]);
    const [sqlLoading, setSqlLoading] = useState(false);

    const savedConnections = parentSavedConnections;
    const activeTab = activeDbTabId || null;
    const openTabs = dbTabs.map((t) => t.id).filter(Boolean);

    useEffect(() => {
        if (typeof onRefreshConnections === 'function') onRefreshConnections();
    }, []);

    const prevActiveTabRef = useRef(activeTab);
    useEffect(() => {
        const prev = prevActiveTabRef.current;
        if (activeTab && activeTab !== prev) {
            setSqlTab(false);
            setPage(0);
            setSortColumn(null);
            setSortDirection('asc');
            setSelectedKeys(new Set());
            setEditingCell(null);
            setSqlColumns([]);
            setSqlRows([]);
            setColumns([]);
            setAllColumns([]);

            runtime?.dbFetchSchema?.({ table: activeTab }).then((schemaResult) => {
                if (schemaResult) {
                    const mapped = schemaResult.columns.map((c) => ({
                        name: c.name, type: c.type, table: activeTab,
                        key: c.key, nullable: c.nullable, default: c.default,
                    }));
                    setColumns(mapped);
                    setAllColumns(mapped);
                }
            }).catch(() => {});

            runtime?.dbFetchRows?.({
                table: activeTab, offset: 0, limit: pageSize,
            }).then((result) => {
                if (result) {
                    const fetchedRows = result.rows || [];
                    const fetchedCols = result.columns || [];
                    setRows(fetchedRows.map((r, idx) => ({
                        ...r, __rowKey: r.id ?? `${activeTab}-${idx}`,
                        __isNew: false, __deleted: false,
                    })));
                    setBaseRows(fetchedRows.map((r, idx) => ({
                        ...r, __rowKey: r.id ?? `${activeTab}-${idx}`,
                    })));
                    setTotalCount(result.totalCount || 0);
                }
            }).catch((e) => console.error('fetchRows failed:', e));
        }
        prevActiveTabRef.current = activeTab;
    }, [activeTab, pageSize]);

    const fetchData = useCallback(async (table, pageNum, sortCol, sortDir, ps) => {
        if (!table) return;
        setLoading(true);
        try {
            const result = await runtime?.dbFetchRows?.({
                table,
                offset: (pageNum || 0) * (ps || pageSize),
                limit: ps || pageSize,
                sortColumn: sortCol,
                sortDirection: sortDir,
            });
            if (result) {
                const fetchedRows = result.rows || [];
                const fetchedCols = result.columns || [];
                setRows(fetchedRows.map((r, idx) => ({ ...r, __rowKey: r.id ?? `${table}-${idx}`, __isNew: false, __deleted: false })));
                setBaseRows(fetchedRows.map((r, idx) => ({ ...r, __rowKey: r.id ?? `${table}-${idx}` })));
                setColumns(fetchedCols);
                setTotalCount(result.totalCount || 0);
                setAllColumns(fetchedCols);
            }
        } catch (e) {
            console.error('fetchRows failed:', e);
        } finally {
            setLoading(false);
        }
    }, [pageSize]);

    const handleActivateTab = useCallback((table) => {
        if (!table) return;
        setSqlTab(false);
        setPage(0);
        setSortColumn(null);
        setSortDirection('asc');
        setSelectedKeys(new Set());
        setEditingCell(null);
        setSqlColumns([]);
        setSqlRows([]);

        if (typeof onActivateDbTab === 'function') {
            onActivateDbTab(table);
        }
    }, [onActivateDbTab]);

    const handleCloseTab = useCallback((table) => {
        if (typeof onCloseDbTab === 'function') {
            onCloseDbTab(table);
        }
    }, [onCloseDbTab]);

    const handleSort = useCallback((colName) => {
        setSortColumn((prev) => {
            const newDir = prev === colName && sortDirection === 'asc' ? 'desc' : 'asc';
            setSortDirection(newDir);
            setPage(0);
            setTimeout(() => fetchData(activeTab, 0, colName, newDir, pageSize), 0);
            return colName;
        });
    }, [sortDirection, activeTab, fetchData, pageSize]);

    const handlePageChange = useCallback((newPage) => {
        setPage(newPage);
        setSelectedKeys(new Set());
        setEditingCell(null);
        fetchData(activeTab, newPage, sortColumn, sortDirection, pageSize);
    }, [activeTab, sortColumn, sortDirection, pageSize, fetchData]);

    const handlePageSizeChange = useCallback((newSize) => {
        setPageSize(newSize);
        setPage(0);
        setSelectedKeys(new Set());
        fetchData(activeTab, 0, sortColumn, sortDirection, newSize);
    }, [activeTab, sortColumn, sortDirection, fetchData]);

    const handleRefresh = useCallback(() => {
        fetchData(activeTab, page, sortColumn, sortDirection, pageSize);
    }, [activeTab, page, sortColumn, sortDirection, pageSize, fetchData]);

    const handleConnect = async (profile) => {
        if (typeof onConnectConnection === 'function') {
            await onConnectConnection(profile);
        }
        setRows([]);
        setColumns([]);
        setTotalCount(0);
        setPage(0);
        setSqlTab(false);
    };

    const handleDisconnect = async () => {
        setRows([]);
        setColumns([]);
        setTotalCount(0);
        setPage(0);
        setSqlTab(false);
        if (typeof onDisconnect === 'function') onDisconnect();
    };

    const handleSaveConnection = async (profile) => {
        if (typeof onSaveConnection === 'function') {
            await onSaveConnection(profile, editingProfile?.alias !== profile.alias ? editingProfile?.alias : undefined);
        } else if (typeof onCreateConnection === 'function') {
            await onCreateConnection(profile);
        }
        setEditModalOpen(false);
        setEditingProfile(null);
    };

    const handleDeleteConnection = async (alias) => {
        if (!window.confirm(`Delete connection "${alias}"?`)) return;
        if (typeof onDeleteConnection === 'function') {
            await onDeleteConnection(alias);
        }
    };

    const handleToggleSelect = (rowKey) => {
        setSelectedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(rowKey)) next.delete(rowKey);
            else next.add(rowKey);
            return next;
        });
    };

    const handleToggleSelectAll = () => {
        if (selectedKeys.size === rows.length) {
            setSelectedKeys(new Set());
        } else {
            setSelectedKeys(new Set(rows.map((r) => r.__rowKey)));
        }
    };

    const handleStartEdit = (rowKey, column, value) => {
        setEditingCell({ rowKey, column, value });
    };

    const handleCommitEdit = (value, isInterim) => {
        if (!editingCell) return;
        if (isInterim) {
            setEditingCell((prev) => ({ ...prev, value }));
            return;
        }
        const { rowKey, column } = editingCell;
        setEditingCell(null);
        setRows((prev) => prev.map((r) => r.__rowKey === rowKey ? { ...r, [column]: value } : r));
    };

    const handleCancelEdit = () => setEditingCell(null);

    const handleInsertRow = () => {
        const newKey = `__new_${Date.now()}_${Math.random()}`;
        const newRow = { __rowKey: newKey, __isNew: true, __deleted: false };
        for (const col of columns) {
            newRow[col.name] = null;
        }
        setRows((prev) => [...prev, newRow]);
    };

    const handleDeleteRow = (rowKey) => {
        setRows((prev) => prev.map((r) => r.__rowKey === rowKey ? { ...r, __deleted: true } : r));
        setSelectedKeys((prev) => { const next = new Set(prev); next.delete(rowKey); return next; });
    };

    const handleDeleteSelected = () => {
        setRows((prev) => prev.map((r) => selectedKeys.has(r.__rowKey) && !r.__isNew ? { ...r, __deleted: true } : r));
        setSelectedKeys(new Set());
    };

    const pendingSummary = useMemo(() => {
        const summary = { inserts: 0, updates: 0, deletes: 0 };
        for (const row of rows) {
            if (row.__deleted) { summary.deletes++; continue; }
            if (row.__isNew) { summary.inserts++; continue; }
            const base = baseRows.find((b) => b.__rowKey === row.__rowKey);
            if (!base) continue;
            for (const key of columns.map((c) => c.name)) {
                if (String(row[key] ?? '') !== String(base[key] ?? '')) {
                    summary.updates++;
                    break;
                }
            }
        }
        return summary;
    }, [rows, baseRows, columns]);

    const handleRevertAll = () => {
        const newRows = baseRows.map((b) => ({ ...b, __isNew: false, __deleted: false }));
        setRows(newRows);
        setSelectedKeys(new Set());
        setEditingCell(null);
    };

    const handleApplyChanges = async () => {
        setApplyModalOpen(true);
    };

    const confirmApply = async () => {
        setApplyModalOpen(false);
        setLoading(true);
        try {
            for (const row of rows) {
                if (row.__deleted) {
                    await runtime?.dbDeleteRow?.({ table: activeTab, id: row.id ?? row.__rowKey });
                } else if (row.__isNew) {
                    await runtime?.dbInsertRow?.({ table: activeTab, row: stripMeta(row) });
                } else {
                    const base = baseRows.find((b) => b.__rowKey === row.__rowKey);
                    if (!base) continue;
                    const delta = {};
                    for (const key of columns.map((c) => c.name)) {
                        if (String(row[key] ?? '') !== String(base[key] ?? '')) delta[key] = row[key];
                    }
                    if (Object.keys(delta).length > 0) {
                        await runtime?.dbUpdateRow?.({ table: activeTab, id: base.id ?? base.__rowKey, row: delta });
                    }
                }
            }
            await handleRefresh();
        } catch (e) {
            console.error('Apply failed:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleExportCsv = () => {
        const csv = toCsv(rows.filter((r) => !r.__deleted), columns);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeTab || 'export'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleSqlQuery = async (sql) => {
        setSqlLoading(true);
        setSqlColumns([]);
        setSqlRows([]);
        try {
            const result = await runtime?.dbExecuteQuery?.({ query: sql });
            if (result) {
                setSqlColumns(result.columns || []);
                setSqlRows(result.rows || []);
            }
        } catch (e) {
            throw e;
        } finally {
            setSqlLoading(false);
        }
    };

    const filteredRows = useMemo(() => {
        if (!filterText.trim()) return rows;
        const lower = filterText.toLowerCase();
        return rows.filter((r) =>
            columns.some((col) => {
                const val = r[col.name];
                return val !== null && val !== undefined && String(val).toLowerCase().includes(lower);
            })
        );
    }, [rows, columns, filterText]);

    const hasPending = pendingSummary.inserts > 0 || pendingSummary.updates > 0 || pendingSummary.deletes > 0;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const selectedForDelete = rows.some((r) => selectedKeys.has(r.__rowKey) && !r.__isNew);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default' }}>
            {!connected ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Box>
                            <Typography variant="subtitle2" sx={{ color: 'primary.light', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 12 }}>
                                Database Viewer
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                                Connect to MySQL or SQLite
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Button size="small" variant="outlined" onClick={() => { setEditingProfile(null); setEditModalOpen(true); }}
                                startIcon={<Plus size={13} />}
                                sx={{ fontSize: 11, borderColor: 'rgba(43,209,255,0.3)', color: 'primary.light' }}>
                                Add Connection
                            </Button>
                            <Tooltip title="Refresh saved connections" arrow>
                                <IconButton size="small" onClick={() => void loadSavedConnections()} sx={{ color: 'text.disabled' }}>
                                    <RefreshCw size={14} />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>

                    {savedConnections.length === 0 ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1, opacity: 0.5 }}>
                            <Database size={32} />
                            <Typography variant="body2" sx={{ color: 'text.disabled', fontSize: 12 }}>
                                No saved connections
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                                Click "Add Connection" to get started.
                            </Typography>
                        </Box>
                    ) : (
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1, overflow: 'auto', flex: 1, alignContent: 'start' }}>
                            {savedConnections.map((profile) => (
                                <Paper key={profile.alias} variant="outlined"
                                    sx={{ p: 1.5, bgcolor: 'rgba(13,18,37,0.6)', borderColor: 'divider', '&:hover': { borderColor: 'rgba(148,163,184,0.3)' } }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12, mb: 0.5, color: 'text.primary' }}>
                                        {profile.alias}
                                    </Typography>
                                    {profile.driver === 'mysql' ? (
                                        <>
                                            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontSize: 10 }}>
                                                MySQL · {profile.host}:{profile.port}
                                            </Typography>
                                            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontSize: 10 }}>
                                                User: {profile.user} · DB: {profile.database}
                                            </Typography>
                                        </>
                                    ) : (
                                        <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontSize: 10, fontFamily: '"JetBrains Mono", monospace', wordBreak: 'break-all' }}>
                                            SQLite · {profile.sqlitePath}
                                        </Typography>
                                    )}
                                    <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
                                        <Button size="small" variant="outlined" onClick={() => void handleConnect(profile)}
                                            startIcon={<Plug size={12} />}
                                            sx={{ fontSize: 10, minWidth: 0, py: 0.25, borderColor: 'rgba(34,197,94,0.3)', color: '#22c55e' }}>
                                            Connect
                                        </Button>
                                        <Button size="small" onClick={() => { setEditingProfile(profile); setEditModalOpen(true); }}
                                            sx={{ fontSize: 10, minWidth: 0, py: 0.25, color: 'text.secondary', '&:hover': { color: 'warning.light' } }}>
                                            Edit
                                        </Button>
                                        <Button size="small" onClick={() => void handleDeleteConnection(profile.alias)}
                                            sx={{ fontSize: 10, minWidth: 0, py: 0.25, color: 'text.secondary', '&:hover': { color: 'error.light' } }}>
                                            Delete
                                        </Button>
                                    </Box>
                                </Paper>
                            ))}
                        </Box>
                    )}
                </Box>
            ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {activeTab ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'rgba(13,18,37,0.8)', overflow: 'auto' }}>
                                {openTabs.map((tab) => (
                                    <Box key={tab} onClick={() => handleActivateTab(tab)}
                                        sx={{
                                            display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.75, cursor: 'pointer', userSelect: 'none',
                                            borderBottom: '2px solid', borderColor: activeTab === tab ? 'primary.light' : 'transparent',
                                            color: activeTab === tab ? 'primary.light' : 'text.disabled',
                                            bgcolor: activeTab === tab ? 'rgba(43,209,255,0.06)' : 'transparent',
                                            '&:hover': { bgcolor: 'rgba(148,163,184,0.06)' },
                                        }}>
                                        <Table2 size={12} />
                                        <Typography variant="caption" sx={{ fontSize: 11, fontWeight: activeTab === tab ? 600 : 400 }}>
                                            {tab}
                                        </Typography>
                                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleCloseTab(tab); }}
                                            sx={{ width: 16, height: 16, color: 'text.disabled', '&:hover': { color: 'error.light' } }}>
                                            <X size={10} />
                                        </IconButton>
                                    </Box>
                                ))}
                                <Box onClick={() => setSqlTab(true)}
                                    sx={{
                                        display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.75, cursor: 'pointer', userSelect: 'none',
                                        borderBottom: '2px solid', borderColor: sqlTab ? 'primary.light' : 'transparent',
                                        color: sqlTab ? 'primary.light' : 'text.disabled',
                                        bgcolor: sqlTab ? 'rgba(43,209,255,0.06)' : 'transparent',
                                        '&:hover': { bgcolor: 'rgba(148,163,184,0.06)' },
                                    }}>
                                    <Terminal size={12} />
                                    <Typography variant="caption" sx={{ fontSize: 11, fontWeight: sqlTab ? 600 : 400 }}>SQL</Typography>
                                </Box>
                            </Box>

                            {sqlTab ? (
                                <Box sx={{ flex: 1, p: 1.5, overflow: 'auto' }}>
                                    <SqlQueryTab columns={sqlColumns} rows={sqlRows} loading={sqlLoading} onRun={handleSqlQuery} />
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                                        <Button size="small" disabled={!selectedForDelete} onClick={handleDeleteSelected}
                                            startIcon={<Trash2 size={12} />}
                                            sx={{ fontSize: 10, minWidth: 0, py: 0.25, color: selectedForDelete ? 'error.light' : 'text.disabled' }}>
                                            Delete Selected
                                        </Button>
                                        <Divider orientation="vertical" flexItem sx={{ borderColor: 'divider' }} />
                                        <TextField
                                            size="small"
                                            placeholder="Filter rows..."
                                            value={filterText}
                                            onChange={(e) => setFilterText(e.target.value)}
                                            sx={{ width: 180 }}
                                            slotProps={{
                                                input: {
                                                    startAdornment: <InputAdornment position="start"><Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>🔍</Typography></InputAdornment>,
                                                    sx: { fontSize: 11, py: 0, bgcolor: 'rgba(13,18,37,0.6)', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' } },
                                                },
                                            }}
                                        />
                                        <Box sx={{ flex: 1 }} />
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                                                {totalCount > 0 ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, totalCount)} of ${totalCount}` : '0 rows'}
                                            </Typography>
                                            <Select
                                                size="small"
                                                value={pageSize}
                                                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                                                sx={{ fontSize: 11, height: 24, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' }, '& .MuiSelect-select': { py: 0 } }}>
                                                {[50, 100, 250, 500, 1000].map((s) => (
                                                    <MenuItem key={s} value={s} sx={{ fontSize: 11 }}>{s}</MenuItem>
                                                ))}
                                            </Select>
                                            <IconButton size="small" disabled={page === 0} onClick={() => handlePageChange(page - 1)}
                                                sx={{ width: 24, height: 24, color: 'text.disabled' }}>
                                                <ChevronLeft size={14} />
                                            </IconButton>
                                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10, minWidth: 40, textAlign: 'center' }}>
                                                {page + 1} / {totalPages}
                                            </Typography>
                                            <IconButton size="small" disabled={page >= totalPages - 1} onClick={() => handlePageChange(page + 1)}
                                                sx={{ width: 24, height: 24, color: 'text.disabled' }}>
                                                <ChevronRight size={14} />
                                            </IconButton>
                                            <Divider orientation="vertical" flexItem sx={{ borderColor: 'divider' }} />
                                            <Tooltip title="Export CSV" arrow>
                                                <IconButton size="small" onClick={handleExportCsv}
                                                    sx={{ width: 24, height: 24, color: 'text.disabled', '&:hover': { color: 'primary.light' } }}>
                                                    <Download size={13} />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Refresh data" arrow>
                                                <IconButton size="small" onClick={() => void handleRefresh()} disabled={loading}
                                                    sx={{ width: 24, height: 24, color: 'text.disabled' }}>
                                                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title={`Disconnect from ${activeDatabase}`} arrow>
                                                <IconButton size="small" onClick={() => void handleDisconnect()}
                                                    sx={{ width: 24, height: 24, color: 'text.disabled', '&:hover': { color: 'error.light' } }}>
                                                    <Unplug size={13} />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    </Box>

                                    <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                        {loading ? (
                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1 }}>
                                                <LoaderCircle size={16} className="animate-spin" />
                                                <Typography variant="caption" sx={{ color: 'text.disabled' }}>Loading data...</Typography>
                                            </Box>
                                        ) : (
                                            <DataTable
                                                columns={columns}
                                                rows={filteredRows}
                                                baseRows={baseRows}
                                                selectedKeys={selectedKeys}
                                                onToggleSelect={handleToggleSelect}
                                                onToggleSelectAll={handleToggleSelectAll}
                                                editingCell={editingCell}
                                                onStartEdit={handleStartEdit}
                                                onCommitEdit={handleCommitEdit}
                                                onCancelEdit={handleCancelEdit}
                                                onInsertRow={handleInsertRow}
                                                onDeleteRow={handleDeleteRow}
                                                sortColumn={sortColumn}
                                                sortDirection={sortDirection}
                                                onSort={handleSort}
                                            />
                                        )}
                                    </Box>

                                    <PendingChangesBar summary={pendingSummary} onRevert={handleRevertAll} onApply={handleApplyChanges} />
                                </Box>
                            )}
                        </>
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 1, p: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Database size={16} style={{ color: '#22c55e' }} />
                                <Typography variant="body2" sx={{ color: 'success.light', fontSize: 12 }}>
                                    Connection active: {activeDatabase}
                                </Typography>
                                <Button size="small" onClick={handleDisconnect}
                                    sx={{ fontSize: 10, minWidth: 0, py: 0.25, color: 'text.secondary', '&:hover': { color: 'error.light' } }}>
                                    Disconnect
                                </Button>
                            </Box>
                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11 }}>
                                Select a table from the sidebar to view data, or open the SQL tab.
                            </Typography>
                            {tables.length > 0 && (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'center', mt: 1, maxWidth: 500 }}>
                                    {tables.map((t) => (
                                        <Chip key={t} label={t} size="small" onClick={() => handleActivateTab(t)}
                                            sx={{ fontSize: 10, cursor: 'pointer', bgcolor: 'rgba(43,209,255,0.08)', color: 'primary.light', '&:hover': { bgcolor: 'rgba(43,209,255,0.15)' } }} />
                                    ))}
                                </Box>
                            )}
                        </Box>
                    )}
                </Box>
            )}

            <ConnectionEditModal open={editModalOpen} initial={editingProfile}
                onSave={handleSaveConnection} onClose={() => { setEditModalOpen(false); setEditingProfile(null); }} />
            <ApplyModal open={applyModalOpen} summary={pendingSummary}
                onApply={() => void confirmApply()} onClose={() => setApplyModalOpen(false)} />
        </Box>
    );
}

export default DatabaseViewerPanel;
