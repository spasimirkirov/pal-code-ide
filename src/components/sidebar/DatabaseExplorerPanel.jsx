import React, { useEffect, useState, useMemo } from 'react';
import {
    Box, Typography, TextField, IconButton, Tooltip, Chip, InputAdornment,
} from '@mui/material';
import { Database, RefreshCw, Search, Table2, Unplug, LoaderCircle } from 'lucide-react';

const runtime = window.palRuntime;

function DatabaseExplorerPanel({ connected, activeDatabase, tables, loadingTables, onRefreshTables, onOpenTable, onDisconnect }) {
    const [filter, setFilter] = useState('');
    const [rowCounts, setRowCounts] = useState({});

    useEffect(() => {
        if (!connected || !tables?.length) {
            setRowCounts({});
            return;
        }
        let cancelled = false;
        const fetchCounts = async () => {
            const counts = {};
            for (const table of tables) {
                if (cancelled) break;
                try {
                    const result = await runtime?.dbGetRowCount?.({ table });
                    if (result && !cancelled) counts[table] = result.count;
                } catch { /* skip failed counts */ }
            }
            if (!cancelled) setRowCounts(counts);
        };
        fetchCounts();
        return () => { cancelled = true; };
    }, [connected, tables]);

    const filteredTables = useMemo(() => {
        if (!filter.trim()) return tables || [];
        const lower = filter.toLowerCase();
        return (tables || []).filter((t) => t.toLowerCase().includes(lower));
    }, [tables, filter]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box>
                    <Typography variant="subtitle2" sx={{ color: 'primary.light', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 11 }}>
                        Database Explorer
                    </Typography>
                    {connected ? (
                        <Typography variant="caption" sx={{ color: 'success.light', fontSize: 10 }}>
                            Connected: {activeDatabase || 'unknown'}
                        </Typography>
                    ) : (
                        <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                            Not connected
                        </Typography>
                    )}
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Refresh tables" arrow placement="left">
                        <IconButton
                            size="small"
                            onClick={onRefreshTables}
                            disabled={!connected || loadingTables}
                            sx={{ color: 'text.disabled' }}
                        >
                            <RefreshCw size={14} className={loadingTables ? 'animate-spin' : ''} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={`Disconnect from ${activeDatabase}`} arrow placement="left">
                        <IconButton
                            size="small"
                            onClick={() => onDisconnect()}
                            disabled={!connected}
                            sx={{ color: 'text.disabled', '&:hover': { color: 'error.light' } }}
                        >
                            <Unplug size={14} />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            {connected && (
                <TextField
                    size="small"
                    fullWidth
                    placeholder="Search tables..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    sx={{ mb: 1 }}
                    slotProps={{
                        input: {
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search size={13} />
                                </InputAdornment>
                            ),
                            sx: {
                                fontSize: 12,
                                bgcolor: 'rgba(13,18,37,0.6)',
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(43,209,255,0.3)' },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(43,209,255,0.5)' },
                            },
                        },
                    }}
                />
            )}

            <Box sx={{ minHeight: 0, flex: 1, overflow: 'auto' }}>
                {!connected ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1, opacity: 0.5 }}>
                        <Unplug size={24} />
                        <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center' }}>
                            Open Database Viewer and connect first.
                        </Typography>
                    </Box>
                ) : loadingTables ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4, gap: 1 }}>
                        <LoaderCircle size={14} className="animate-spin" />
                        <Typography variant="caption" sx={{ color: 'text.disabled' }}>Loading tables...</Typography>
                    </Box>
                ) : filteredTables.length === 0 ? (
                    <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', py: 4, color: 'text.disabled' }}>
                        {filter ? 'No tables match your search.' : 'No tables available.'}
                    </Typography>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                        {filteredTables.map((table) => (
                            <Box
                                key={table}
                                onClick={() => onOpenTable?.(table)}
                                sx={{
                                    display: 'flex', alignItems: 'center', gap: 1,
                                    px: 1, py: 0.75, borderRadius: 1, cursor: 'pointer',
                                    '&:hover': { bgcolor: 'rgba(43,209,255,0.08)' },
                                }}
                            >
                                <Table2 size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
                                <Typography
                                    variant="caption"
                                    sx={{
                                        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap', color: 'text.primary', fontSize: 12,
                                        fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
                                    }}
                                >
                                    {table}
                                </Typography>
                                {rowCounts[table] !== undefined && (
                                    <Chip
                                        label={rowCounts[table].toLocaleString()}
                                        size="small"
                                        sx={{
                                            height: 16, minWidth: 16, fontSize: 9,
                                            '& .MuiChip-label': { px: 0.5 },
                                            bgcolor: 'rgba(148,163,184,0.12)', color: 'text.disabled',
                                        }}
                                    />
                                )}
                            </Box>
                        ))}
                    </Box>
                )}
            </Box>
        </Box>
    );
}

export default DatabaseExplorerPanel;
