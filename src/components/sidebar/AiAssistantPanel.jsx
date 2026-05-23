import React, { useEffect, useState } from 'react';
import {
    Box, Typography, TextField, Select, MenuItem, IconButton,
    Alert, CircularProgress, Tooltip, Chip, Switch, FormControlLabel,
    Paper,
} from '@mui/material';
import { RefreshCw, Sparkles, Bot, CheckCircle2, XCircle, Globe, Server, Cpu, Cog } from 'lucide-react';

const runtime = window.palRuntime;

const defaultSettings = {
    engine: 'lm-studio',
    agentType: 'built-in',
    lmStudio: { endpointUrl: 'http://localhost:1234', port: '1234', activeModel: '' },
    aider: { autoCommits: false, autoLint: true, mapTokens: 1024 },
    opencode: { model: '', apiKey: '' },
};

function AiAssistantPanel() {
    const [settings, setSettings] = useState(defaultSettings);
    const [lmStudioModels, setLmStudioModels] = useState([]);
    const [lmStudioLoading, setLmStudioLoading] = useState(false);
    const [lmStudioError, setLmStudioError] = useState('');
    const [lmStudioReachable, setLmStudioReachable] = useState(true);
    const [aiderStatus, setAiderStatus] = useState(null);
    const [aiderLoading, setAiderLoading] = useState(false);
    const [opencodeStatus, setOpencodeStatus] = useState(null);
    const [opencodeLoading, setOpencodeLoading] = useState(false);

    const hydrate = async () => {
        try {
            const nextSettings = await runtime?.getAiAssistantSettings?.();
            if (nextSettings) setSettings(nextSettings);
        } catch { /* */ }
    };

    useEffect(() => {
        let mounted = true;
        const init = async () => { if (mounted) await hydrate(); };
        void init();
        return () => { mounted = false; };
    }, []);

    const updateSettings = async (patch) => {
        const next = await runtime?.setAiAssistantSettings?.(patch);
        if (next) setSettings(next);
    };

    const refreshLmStudioModels = async () => {
        setLmStudioError('');
        setLmStudioLoading(true);
        try {
            const response = await runtime?.lmStudioGetModels?.({ endpointUrl: settings.lmStudio.endpointUrl, port: settings.lmStudio.port });
            setLmStudioModels(Array.isArray(response?.models) ? response.models : []);
            setLmStudioReachable(true);
        } catch (error) {
            setLmStudioReachable(false);
            setLmStudioModels([]);
            setLmStudioError(error?.message || "Can't reach LM Studio API.");
        } finally { setLmStudioLoading(false); }
    };

    const checkAider = async () => {
        setAiderLoading(true);
        try {
            const result = await runtime?.aiderCheck?.();
            setAiderStatus(result || { available: false, error: 'No response' });
        } catch { setAiderStatus({ available: false, error: 'Failed to check Aider' }); }
        finally { setAiderLoading(false); }
    };

    const checkOpencode = async () => {
        setOpencodeLoading(true);
        try {
            const result = await runtime?.opencodeCheck?.();
            setOpencodeStatus(result || { available: false, error: 'No response' });
        } catch { setOpencodeStatus({ available: false, error: 'Failed to check OpenCode' }); }
        finally { setOpencodeLoading(false); }
    };

    useEffect(() => {
        void refreshLmStudioModels();
        void checkAider();
        void checkOpencode();
    }, []);

    return (
        <Box sx={{ height: '100%', overflowY: 'auto', bgcolor: 'background.default' }}>
            <Box sx={{ px: 4, py: 3, maxWidth: 720, mx: 'auto' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 1.5, bgcolor: 'rgba(43, 209, 255, 0.12)' }}>
                        <Cog size={18} style={{ color: '#2bd1ff' }} />
                    </Box>
                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '0.01em', color: 'text.primary' }}>
                            AI Assistant
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.7rem' }}>
                            Configure provider, model, and agent engine
                        </Typography>
                    </Box>
                </Box>

                {/* Provider */}
                <Paper sx={{ p: 3, mb: 2.5, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
                        <Server size={16} style={{ color: '#2bd1ff' }} />
                        <Typography variant="subtitle2" sx={{ color: 'primary.light', fontSize: '0.7rem' }}>Provider</Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, p: 1.5, borderRadius: 1.5, bgcolor: 'rgba(13, 18, 37, 0.5)' }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: lmStudioReachable ? '#4ade80' : '#fb7185', flexShrink: 0 }} />
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>LM Studio</Typography>
                            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>
                                {lmStudioReachable ? 'Reachable' : 'Unreachable'}
                            </Typography>
                        </Box>
                        {lmStudioLoading && <CircularProgress size={14} />}
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            fullWidth size="small" label="Endpoint URL"
                            value={settings.lmStudio.endpointUrl}
                            onChange={(e) => setSettings((s) => ({ ...s, lmStudio: { ...s.lmStudio, endpointUrl: e.target.value } }))}
                            onBlur={() => void updateSettings({ lmStudio: { endpointUrl: settings.lmStudio.endpointUrl } })}
                            placeholder="http://localhost:1234"
                            sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem' }, '& .MuiInputLabel-root': { fontSize: '0.75rem' } }}
                        />
                        <TextField
                            size="small" label="Port" sx={{ width: 120 }}
                            value={settings.lmStudio.port}
                            onChange={(e) => setSettings((s) => ({ ...s, lmStudio: { ...s.lmStudio, port: e.target.value } }))}
                            onBlur={() => void updateSettings({ lmStudio: { port: settings.lmStudio.port } })}
                            placeholder="1234"
                            slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                            sx={{ '& .MuiInputLabel-root': { fontSize: '0.75rem' } }}
                        />
                    </Box>

                    {!lmStudioReachable && !lmStudioError && (
                        <Alert severity="warning" sx={{ mt: 2, py: 0.75, px: 2, fontSize: '0.75rem', borderRadius: 1.5 }}>
                            LM Studio is unreachable. Start it, then refresh models.
                        </Alert>
                    )}
                    {lmStudioError && (
                        <Alert severity="error" sx={{ mt: 2, py: 0.75, px: 2, fontSize: '0.75rem', borderRadius: 1.5 }}>{lmStudioError}</Alert>
                    )}
                </Paper>

                {/* Model */}
                <Paper sx={{ p: 3, mb: 2.5, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Cpu size={16} style={{ color: '#2bd1ff' }} />
                            <Typography variant="subtitle2" sx={{ color: 'primary.light', fontSize: '0.7rem' }}>Model</Typography>
                        </Box>
                        <Tooltip title="Refresh models">
                            <IconButton size="small" onClick={() => void refreshLmStudioModels()} disabled={lmStudioLoading} sx={{ width: 28, height: 28 }}>
                                {lmStudioLoading ? <CircularProgress size={14} /> : <RefreshCw size={14} />}
                            </IconButton>
                        </Tooltip>
                    </Box>

                    <Select
                        fullWidth size="small"
                        value={settings.lmStudio.activeModel}
                        disabled={!lmStudioReachable || lmStudioLoading}
                        onChange={(e) => void updateSettings({ lmStudio: { activeModel: e.target.value } })}
                        displayEmpty
                        sx={{ fontSize: '0.8rem', '& .MuiSelect-select': { py: 1 } }}
                    >
                        <MenuItem value="" disabled><em>Select a model</em></MenuItem>
                        {lmStudioModels.map((m) => (<MenuItem key={m.id} value={m.id}>{m.id}</MenuItem>))}
                    </Select>

                    {settings.lmStudio.activeModel && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1.5 }}>
                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main' }} />
                            <Typography variant="caption" sx={{ color: 'success.light', fontSize: '0.7rem' }}>
                                Active: {settings.lmStudio.activeModel}
                            </Typography>
                        </Box>
                    )}
                </Paper>

                {/* Agent Engine */}
                <Paper sx={{ p: 3, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                        <Bot size={16} style={{ color: '#2bd1ff' }} />
                        <Typography variant="subtitle2" sx={{ color: 'primary.light', fontSize: '0.7rem' }}>Agent Engine</Typography>
                    </Box>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {/* Built-in */}
                        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(43, 209, 255, 0.04)', border: '1px solid', borderColor: 'rgba(43, 209, 255, 0.15)' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 1.5, bgcolor: 'rgba(43, 209, 255, 0.1)' }}>
                                    <Sparkles size={16} style={{ color: '#2bd1ff' }} />
                                </Box>
                                <Box sx={{ flex: 1 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>Built-in Agent</Typography>
                                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem', display: 'block' }}>
                                        PAL IDE's native agent with tool orchestration, file editing, and code search
                                    </Typography>
                                </Box>
                                <Chip
                                    label="Default"
                                    size="small"
                                    sx={{ height: 22, fontSize: '0.6rem', bgcolor: 'rgba(43, 209, 255, 0.1)', color: 'primary.light', fontWeight: 600, borderRadius: 1 }}
                                />
                            </Box>
                        </Box>

                        {/* Aider */}
                        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(74, 222, 128, 0.04)', border: '1px solid', borderColor: 'divider' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 1.5, bgcolor: 'rgba(74, 222, 128, 0.1)' }}>
                                    <Bot size={16} style={{ color: '#4ade80' }} />
                                </Box>
                                <Box sx={{ flex: 1 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>Aider</Typography>
                                        {aiderStatus && (
                                            <Chip
                                                label={aiderStatus.available ? 'Ready' : 'Unavailable'}
                                                size="small"
                                                sx={{
                                                    height: 20, fontSize: '0.55rem', fontWeight: 600, borderRadius: 1,
                                                    bgcolor: aiderStatus.available ? 'rgba(74, 222, 128, 0.12)' : 'rgba(251, 113, 133, 0.12)',
                                                    color: aiderStatus.available ? 'success.light' : 'error.light',
                                                }}
                                            />
                                        )}
                                    </Box>
                                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem', display: 'block' }}>
                                        External agent via CLI with auto-commit and lint support
                                    </Typography>
                                </Box>
                                <Tooltip title="Check Aider availability">
                                    <IconButton size="small" onClick={() => void checkAider()} disabled={aiderLoading} sx={{ width: 28, height: 28 }}>
                                        {aiderLoading ? <CircularProgress size={12} /> : <RefreshCw size={13} />}
                                    </IconButton>
                                </Tooltip>
                            </Box>

                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={settings.agentType === 'aider'}
                                        onChange={(e) => void updateSettings({ agentType: e.target.checked ? 'aider' : 'built-in' })}
                                    />
                                }
                                label="Use Aider as agent backend"
                                sx={{ '& .MuiTypography-root': { fontSize: '0.75rem' } }}
                            />

                            {aiderStatus && !aiderStatus.available && (
                                <Alert severity="error" sx={{ mt: 1.5, py: 0.5, px: 1.5, fontSize: '0.6875rem', borderRadius: 1.5 }}>
                                    {aiderStatus.error || 'Aider CLI not found in PATH'}
                                </Alert>
                            )}
                            {aiderStatus?.available && (
                                <Typography variant="caption" sx={{ color: 'success.light', fontSize: '0.65rem', display: 'block', mt: 0.5, ml: 5 }}>
                                    Version {aiderStatus.version}
                                </Typography>
                            )}
                        </Box>

                        {/* OpenCode */}
                        <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(105, 168, 255, 0.04)', border: '1px solid', borderColor: 'divider' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 1.5, bgcolor: 'rgba(105, 168, 255, 0.1)' }}>
                                    <Globe size={16} style={{ color: '#69a8ff' }} />
                                </Box>
                                <Box sx={{ flex: 1 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>OpenCode</Typography>
                                        {opencodeStatus && (
                                            <Chip
                                                label={opencodeStatus.available ? 'Ready' : 'Unavailable'}
                                                size="small"
                                                sx={{
                                                    height: 20, fontSize: '0.55rem', fontWeight: 600, borderRadius: 1,
                                                    bgcolor: opencodeStatus.available ? 'rgba(74, 222, 128, 0.12)' : 'rgba(251, 113, 133, 0.12)',
                                                    color: opencodeStatus.available ? 'success.light' : 'error.light',
                                                }}
                                            />
                                        )}
                                    </Box>
                                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem', display: 'block' }}>
                                        Autonomous coding agent from opencode.ai
                                    </Typography>
                                </Box>
                                <Tooltip title="Check OpenCode availability">
                                    <IconButton size="small" onClick={() => void checkOpencode()} disabled={opencodeLoading} sx={{ width: 28, height: 28 }}>
                                        {opencodeLoading ? <CircularProgress size={12} /> : <RefreshCw size={13} />}
                                    </IconButton>
                                </Tooltip>
                            </Box>

                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={settings.agentType === 'opencode'}
                                        onChange={(e) => void updateSettings({ agentType: e.target.checked ? 'opencode' : 'built-in' })}
                                    />
                                }
                                label="Use OpenCode as agent backend"
                                sx={{ '& .MuiTypography-root': { fontSize: '0.75rem' } }}
                            />

                            {opencodeStatus && !opencodeStatus.available && (
                                <Alert severity="error" sx={{ mt: 1.5, py: 0.5, px: 1.5, fontSize: '0.6875rem', borderRadius: 1.5 }}>
                                    {opencodeStatus.error || 'OpenCode CLI not found in PATH'}
                                </Alert>
                            )}
                            {opencodeStatus?.available && (
                                <Typography variant="caption" sx={{ color: 'success.light', fontSize: '0.65rem', display: 'block', mt: 0.5, ml: 5 }}>
                                    Version {opencodeStatus.version}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                </Paper>
            </Box>
        </Box>
    );
}

export default AiAssistantPanel;
