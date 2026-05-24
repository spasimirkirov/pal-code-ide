import React, { useEffect, useState } from 'react';
import { Box, Typography, Chip, Menu, MenuItem, Select, Tooltip } from '@mui/material';

const MODE_LABELS = { all: 'All', safe: 'Safe', manual: 'Manual' };
const MODE_COLORS = { all: 'success', safe: 'warning', manual: 'error' };
const TERMINAL_STATE_COLORS = {
    running: '#4ade80',
    starting: '#fbbf24',
    idle: '#94a3b8',
    closed: '#64748b',
};

const runtime = window.palRuntime;

function StatusBar({ hardware, modelPerf, terminalState, autoApprovalMode, onAutoApprovalModeChange, onRefreshSettings }) {
    const [models, setModels] = useState([]);
    const [modelsLoading, setModelsLoading] = useState(false);
    const [activeModel, setActiveModel] = useState('');
    const [loadingModel, setLoadingModel] = useState(false);
    const [menuAnchor, setMenuAnchor] = useState(null);

    useEffect(() => {
        const load = async () => {
            if (!runtime?.getAiAssistantSettings) return;
            try {
                const s = await runtime.getAiAssistantSettings();
                if (s?.lmStudio?.activeModel) setActiveModel(s.lmStudio.activeModel);
            } catch {}
        };
        void load();
    }, []);

    useEffect(() => {
        if (!runtime?.lmStudioGetModels) return;
        let mounted = true;
        setModelsLoading(true);
        (async () => {
            try {
                const settings = await runtime.getAiAssistantSettings?.();
                const endpointUrl = settings?.lmStudio?.apiEndpointUrl || 'http://127.0.0.1:1234';
                const resp = await runtime.lmStudioGetModels({ endpointUrl, port: '' });
                if (mounted && resp?.models) setModels(resp.models);
            } catch {}
            if (mounted) setModelsLoading(false);
        })();
        return () => { mounted = false; };
    }, []);

    // Reset Select value if saved model isn't in the available list
    useEffect(() => {
        if (models.length > 0 && activeModel && !models.some((m) => m.id === activeModel)) {
            setActiveModel('');
        }
    }, [models, activeModel]);

    const handleModelChange = async (modelId) => {
        setActiveModel(modelId);
        await runtime?.setAiAssistantSettings?.({ lmStudio: { activeModel: modelId } });
        setLoadingModel(true);
        try {
            await runtime?.lmStudioLoadModel?.({ modelId });
        } catch {}
        setLoadingModel(false);
        onRefreshSettings?.();
    };

    const formatTokens = (v) => (v && v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v || 0}`);
    const vramPercent = hardware.vramTotal > 0 ? Math.max(0, Math.min(100, (hardware.vramUsed / hardware.vramTotal) * 100)) : 0;
    const activeTerminalStatus = String(terminalState?.activeStatus || 'idle');
    const runningTerminals = Number(terminalState?.running || 0);
    const totalTerminals = Math.max(1, Number(terminalState?.total || 1));
    const safeModelValue = models.some((model) => model.id === activeModel) ? activeModel : '';

    return (
        <Box
            sx={{
                display: 'flex', height: 24, alignItems: 'center', justifyContent: 'space-between',
                px: 1.5, borderTop: '1px solid', borderColor: 'divider',
                bgcolor: 'rgba(7, 11, 20, 0.6)',
            }}
        >
            {/* Left: VRAM */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.disabled', whiteSpace: 'nowrap' }}>
                        VRAM: {(hardware.vramUsed / 1024).toFixed(1)} / {(hardware.vramTotal / 1024).toFixed(1)} GB
                    </Typography>
                        <Box sx={{ width: 40, height: 3, borderRadius: 1, bgcolor: 'rgba(148,163,184,0.15)', overflow: 'hidden' }}>
                        <Box sx={{ height: '100%', borderRadius: 1, background: 'linear-gradient(90deg, #2bd1ff, #4ade80)', width: `${vramPercent}%` }} />
                    </Box>
                </Box>

                <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>
                    {modelPerf.tokensPerSec.toFixed(1)} t/s &middot; {formatTokens(modelPerf.contextUsed)}/{formatTokens(modelPerf.contextTotal)}
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box
                        sx={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            bgcolor: TERMINAL_STATE_COLORS[activeTerminalStatus] || TERMINAL_STATE_COLORS.idle,
                        }}
                    />
                    <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>
                        term {runningTerminals}/{totalTerminals} {activeTerminalStatus}
                    </Typography>
                </Box>
            </Box>

            {/* Right: Model selector + auto-approval */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Select
                    size="small"
                    value={safeModelValue}
                    displayEmpty
                    disabled={modelsLoading || loadingModel}
                    onChange={(e) => void handleModelChange(e.target.value)}
                    sx={{
                        height: 18, fontSize: '0.6rem', minWidth: 120, maxWidth: 200,
                        '& .MuiSelect-select': { py: 0, px: 0.75 },
                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148,163,184,0.2)' },
                        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148,163,184,0.4)' },
                        color: 'text.secondary',
                    }}
                    renderValue={(v) => loadingModel ? 'Loading...' : (v || 'Select model')}
                >
                    {models.map((m) => (
                        <MenuItem key={m.id} value={m.id} sx={{ fontSize: '0.65rem' }}>{m.id}</MenuItem>
                    ))}
                </Select>

                <Chip
                    size="small"
                    label={MODE_LABELS[autoApprovalMode] || 'All'}
                    color={MODE_COLORS[autoApprovalMode] || 'success'}
                    variant="outlined"
                    onClick={(e) => setMenuAnchor(e.currentTarget)}
                    sx={{ height: 18, fontSize: '0.55rem', '& .MuiChip-label': { px: 0.5 } }}
                />
                <Menu
                    anchorEl={menuAnchor}
                    open={Boolean(menuAnchor)}
                    onClose={() => setMenuAnchor(null)}
                    anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    slotProps={{ paper: { sx: { minWidth: 140, bgcolor: 'rgba(7,11,20,0.95)', backdropFilter: 'blur(8px)' } } }}
                >
                    <MenuItem dense disabled sx={{ fontSize: '0.65rem', opacity: 0.6 }}>Auto-approval</MenuItem>
                    {Object.entries(MODE_LABELS).map(([key, label]) => (
                        <MenuItem
                            key={key}
                            dense
                            selected={autoApprovalMode === key}
                            onClick={() => { setMenuAnchor(null); onAutoApprovalModeChange?.(key); }}
                            sx={{ fontSize: '0.7rem', gap: 1 }}
                        >
                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: key === 'all' ? '#4ade80' : key === 'safe' ? '#fbbf24' : '#fb7185' }} />
                            {label}
                            <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'text.disabled', ml: 'auto' }}>
                                {key === 'all' ? 'except terminal' : key === 'safe' ? 'reads only' : 'all actions'}
                            </Typography>
                        </MenuItem>
                    ))}
                </Menu>
            </Box>
        </Box>
    );
}

export default StatusBar;