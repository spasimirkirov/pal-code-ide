import React, { useEffect, useMemo, useState } from 'react';
import {
    Box, Typography, Button, IconButton, Tooltip, TextField, Chip, Divider,
} from '@mui/material';
import {
    GitCommitHorizontal, LoaderCircle, Plus, Minus, RotateCcw, Undo2,
    RefreshCw, CheckCheck, CheckCircle2, File, FileText, FileX2,
} from 'lucide-react';

const runtime = window.palRuntime;

const FILE_TYPE_LABELS = {
    A: { label: 'A', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
    M: { label: 'M', color: '#facc15', bg: 'rgba(250,204,21,0.15)' },
    D: { label: 'D', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
    R: { label: 'R', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
    '?': { label: 'U', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
};

function StatusBadge({ code }) {
    const info = FILE_TYPE_LABELS[code] || FILE_TYPE_LABELS['?'];
    return (
        <Typography
            component="span"
            sx={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, borderRadius: '3px', fontSize: 10, fontWeight: 700,
                lineHeight: 1, color: info.color, bgcolor: info.bg, flexShrink: 0,
            }}
        >
            {info.label}
        </Typography>
    );
}

function GitFileRow({ file, kind, actionBusyPath, onOpenDiff, onStage, onUnstage, onRevert }) {
    const isBusy = actionBusyPath === file.path;
    const workingCode = kind === 'staged' ? file.index : (file.workingDir === '?' ? '?' : file.workingDir);
    const showChangeCount = file.additions > 0 || file.deletions > 0;
    const stagedCode = file.index && file.index !== ' ' ? file.index : null;

    return (
        <Box
            sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                px: 1, py: 0.75, borderRadius: 1,
                '&:hover': { bgcolor: 'rgba(148,163,184,0.08)' },
                minHeight: 32,
            }}
        >
            <StatusBadge code={workingCode} />
            <Box
                component="button"
                onClick={() => onOpenDiff?.(file.path)}
                sx={{
                    flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer',
                    background: 'none', border: 'none', p: 0, color: 'inherit',
                }}
            >
                <Typography
                    variant="caption"
                    sx={{
                        display: 'block', color: 'text.primary', fontSize: 12,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
                    }}
                >
                    {file.path}
                </Typography>
            </Box>
            {showChangeCount && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                    {file.additions > 0 && (
                        <Typography variant="caption" sx={{ color: '#22c55e', fontSize: 11, fontWeight: 600 }}>
                            +{file.additions}
                        </Typography>
                    )}
                    {file.deletions > 0 && (
                        <Typography variant="caption" sx={{ color: '#ef4444', fontSize: 11, fontWeight: 600 }}>
                            -{file.deletions}
                        </Typography>
                    )}
                </Box>
            )}
            {kind === 'staged' ? (
                <Tooltip title="Unstage" arrow placement="top">
                    <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); onUnstage?.(file.path); }}
                        sx={{ width: 24, height: 24, color: 'text.disabled', '&:hover': { color: 'warning.light' } }}
                    >
                        {isBusy ? <LoaderCircle size={13} className="animate-spin" /> : <Minus size={13} />}
                    </IconButton>
                </Tooltip>
            ) : (
                <>
                    <Tooltip title="Stage" arrow placement="top">
                        <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); onStage?.(file.path); }}
                            sx={{ width: 24, height: 24, color: 'text.disabled', '&:hover': { color: 'success.light' } }}
                        >
                            {isBusy ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} />}
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Revert" arrow placement="top">
                        <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); onRevert?.(file.path); }}
                            sx={{ width: 24, height: 24, color: 'text.disabled', '&:hover': { color: 'error.light' } }}
                        >
                            <RotateCcw size={13} />
                        </IconButton>
                    </Tooltip>
                </>
            )}
        </Box>
    );
}

function GitFileList({ title, files, kind, actionBusyPath, onOpenDiff, onStage, onUnstage, onRevert }) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <Box sx={{ mb: 1 }}>
            <Box
                component="button"
                onClick={() => setCollapsed((c) => !c)}
                sx={{
                    display: 'flex', alignItems: 'center', gap: 1, width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer', p: 0.5, mb: 0.5,
                    '&:hover': { opacity: 0.8 },
                }}
            >
                <Typography
                    variant="caption"
                    sx={{
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        fontWeight: 600, fontSize: 10, color: 'text.secondary',
                    }}
                >
                    {title}
                </Typography>
                <Chip
                    label={files.length}
                    size="small"
                    sx={{
                        height: 16, minWidth: 16, fontSize: 10,
                        '& .MuiChip-label': { px: 0.5 },
                        bgcolor: 'rgba(148,163,184,0.12)', color: 'text.secondary',
                    }}
                />
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                    {collapsed ? '▸' : '▾'}
                </Typography>
            </Box>
            {!collapsed && (
                <Box
                    sx={{
                        borderRadius: 1, border: '1px solid', borderColor: 'divider',
                        bgcolor: 'rgba(13,18,37,0.5)', overflow: 'hidden',
                    }}
                >
                    {files.length === 0 ? (
                        <Typography variant="caption" sx={{ display: 'block', p: 1.5, color: 'text.disabled', textAlign: 'center' }}>
                            No files
                        </Typography>
                    ) : (
                        files.map((file) => (
                            <GitFileRow
                                key={`${kind}-${file.path}`}
                                file={file}
                                kind={kind}
                                actionBusyPath={actionBusyPath}
                                onOpenDiff={onOpenDiff}
                                onStage={onStage}
                                onUnstage={onUnstage}
                                onRevert={onRevert}
                            />
                        ))
                    )}
                </Box>
            )}
        </Box>
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
        if (!runtime?.gitStatus) return;
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
        const handleExternalRefresh = () => void refreshStatus();
        window.addEventListener('pal:git-refresh', handleExternalRefresh);
        return () => window.removeEventListener('pal:git-refresh', handleExternalRefresh);
    }, []);

    const stagedCount = status.staged.length;
    const unstagedCount = status.unstaged.length;
    const hasChanges = stagedCount > 0 || unstagedCount > 0;

    const stagedAdditions = useMemo(
        () => status.staged.reduce((s, f) => s + f.additions, 0),
        [status.staged],
    );
    const stagedDeletions = useMemo(
        () => status.staged.reduce((s, f) => s + f.deletions, 0),
        [status.staged],
    );
    const unstagedAdditions = useMemo(
        () => status.unstaged.reduce((s, f) => s + f.additions, 0),
        [status.unstaged],
    );
    const unstagedDeletions = useMemo(
        () => status.unstaged.reduce((s, f) => s + f.deletions, 0),
        [status.unstaged],
    );

    const handleAiCommit = async () => {
        setAiLoading(true);
        setInfo('');
        await new Promise((resolve) => setTimeout(resolve, 1200));
        setInfo('AI Commit summary mock complete. Qwen integration pending.');
        setAiLoading(false);
    };

    const handleCommit = async () => {
        if (!message.trim()) { setError('Please provide a commit message.'); return; }
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
        try { await runtime.gitStageFile({ filePath }); await refreshStatus(); }
        catch (nextError) { setError(nextError?.message || 'Failed to stage file.'); }
        finally { setActionBusyPath(''); }
    };

    const handleUnstageFile = async (filePath) => {
        setActionBusyPath(filePath);
        setError('');
        try { await runtime.gitUnstageFile({ filePath }); await refreshStatus(); }
        catch (nextError) { setError(nextError?.message || 'Failed to unstage file.'); }
        finally { setActionBusyPath(''); }
    };

    const handleRevertFile = async (filePath) => {
        setActionBusyPath(filePath);
        setError('');
        try { await runtime.gitRevertFile({ filePath }); await refreshStatus(); }
        catch (nextError) { setError(nextError?.message || 'Failed to revert file.'); }
        finally { setActionBusyPath(''); }
    };

    const handleStageAll = async () => {
        if (!runtime?.gitStageAll) return;
        setLoading(true);
        setError('');
        try { await runtime.gitStageAll(); await refreshStatus(); }
        catch (nextError) { setError(nextError?.message || 'Failed to stage all changes.'); }
        finally { setLoading(false); }
    };

    const handleUnstageAll = async () => {
        if (!runtime?.gitUnstageAll) return;
        setLoading(true);
        setError('');
        try { await runtime.gitUnstageAll(); await refreshStatus(); }
        catch (nextError) { setError(nextError?.message || 'Failed to unstage all changes.'); }
        finally { setLoading(false); }
    };

    const handleRevertAll = async () => {
        if (!runtime?.gitRevertAll) return;
        const shouldRevert = window.confirm('Revert all unstaged changes? This cannot be undone.');
        if (!shouldRevert) return;
        setLoading(true);
        setError('');
        try { await runtime.gitRevertAll(); await refreshStatus(); }
        catch (nextError) { setError(nextError?.message || 'Failed to revert all changes.'); }
        finally { setLoading(false); }
    };

    if (!status.isRepo) {
        return (
            <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', p: 2 }}>
                <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center' }}>
                    This workspace is not a git repository.
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box>
                    <Typography variant="subtitle2" sx={{ color: 'primary.light', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 11 }}>
                        Source Control
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                        {status.branch || 'unknown'}
                    </Typography>
                </Box>
                <Tooltip title="Refresh" arrow placement="left">
                    <IconButton size="small" onClick={() => void refreshStatus()} sx={{ color: 'text.disabled' }}>
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </IconButton>
                </Tooltip>
            </Box>

            <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
                <Tooltip title={unstagedCount === 0 ? 'No unstaged changes' : 'Stage all changes'} arrow>
                    <Box sx={{ flex: 1 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            fullWidth
                            disabled={loading || unstagedCount === 0}
                            onClick={() => void handleStageAll()}
                            startIcon={loading ? <LoaderCircle size={13} className="animate-spin" /> : <CheckCheck size={13} />}
                            sx={{
                                fontSize: 10, py: 0.5, minHeight: 28,
                                borderColor: 'rgba(34,197,94,0.25)', color: '#4ade80',
                                '&:hover': { borderColor: 'rgba(34,197,94,0.5)', bgcolor: 'rgba(34,197,94,0.08)' },
                                '&.Mui-disabled': { borderColor: 'divider', color: 'text.disabled' },
                            }}
                        >
                            Stage All
                        </Button>
                    </Box>
                </Tooltip>
                <Tooltip title={stagedCount === 0 ? 'No staged changes' : 'Unstage all changes'} arrow>
                    <Box sx={{ flex: 1 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            fullWidth
                            disabled={loading || stagedCount === 0}
                            onClick={() => void handleUnstageAll()}
                            startIcon={loading ? <LoaderCircle size={13} className="animate-spin" /> : <Minus size={13} />}
                            sx={{
                                fontSize: 10, py: 0.5, minHeight: 28,
                                borderColor: 'rgba(250,204,21,0.25)', color: '#facc15',
                                '&:hover': { borderColor: 'rgba(250,204,21,0.5)', bgcolor: 'rgba(250,204,21,0.08)' },
                                '&.Mui-disabled': { borderColor: 'divider', color: 'text.disabled' },
                            }}
                        >
                            Unstage
                        </Button>
                    </Box>
                </Tooltip>
                <Tooltip title={unstagedCount === 0 ? 'No unstaged changes' : 'Revert all unstaged changes'} arrow>
                    <Box sx={{ flex: 1 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            fullWidth
                            disabled={loading || unstagedCount === 0}
                            onClick={() => void handleRevertAll()}
                            startIcon={loading ? <LoaderCircle size={13} className="animate-spin" /> : <Undo2 size={13} />}
                            sx={{
                                fontSize: 10, py: 0.5, minHeight: 28,
                                borderColor: 'rgba(239,68,68,0.25)', color: '#f87171',
                                '&:hover': { borderColor: 'rgba(239,68,68,0.5)', bgcolor: 'rgba(239,68,68,0.08)' },
                                '&.Mui-disabled': { borderColor: 'divider', color: 'text.disabled' },
                            }}
                        >
                            Revert
                        </Button>
                    </Box>
                </Tooltip>
            </Box>

            <Divider sx={{ mb: 1 }} />

            <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                    size="small"
                    fullWidth
                    placeholder="Commit message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    slotProps={{
                        input: {
                            sx: {
                                fontSize: 12, py: 0,
                                bgcolor: 'rgba(13,18,37,0.6)',
                                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
                                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(43,209,255,0.3)' },
                                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(43,209,255,0.5)' },
                            },
                        },
                    }}
                />
                <Tooltip title="AI commit (mock)" arrow>
                    <IconButton
                        size="small"
                        disabled={aiLoading}
                        onClick={() => void handleAiCommit()}
                        sx={{
                            width: 32, height: 32,
                            border: '1px solid', borderColor: 'rgba(251,191,36,0.25)',
                            color: '#fbbf24', borderRadius: 1,
                            '&:hover': { bgcolor: 'rgba(251,191,36,0.08)' },
                        }}
                    >
                        {aiLoading ? <LoaderCircle size={14} className="animate-spin" /> : <GitCommitHorizontal size={14} />}
                    </IconButton>
                </Tooltip>
            </Box>

            <Button
                size="small"
                variant="outlined"
                fullWidth
                disabled={!hasChanges || loading || !message.trim()}
                onClick={() => void handleCommit()}
                startIcon={loading ? <LoaderCircle size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                sx={{
                    fontSize: 11, py: 0.75, mb: 1.5,
                    borderColor: 'rgba(43,209,255,0.25)', color: 'primary.light',
                    '&:hover': { borderColor: 'rgba(43,209,255,0.5)', bgcolor: 'rgba(43,209,255,0.08)' },
                    '&.Mui-disabled': { borderColor: 'divider', color: 'text.disabled' },
                }}
            >
                Commit Changes
            </Button>

            {error && (
                <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'error.light', fontSize: 11 }}>
                    {error}
                </Typography>
            )}
            {info && (
                <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'success.light', fontSize: 11 }}>
                    {info}
                </Typography>
            )}

            <Box sx={{ display: 'flex', gap: 1.5, mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" sx={{ color: '#22c55e', fontSize: 11, fontWeight: 600 }}>
                        +{stagedAdditions + unstagedAdditions}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                        /
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#ef4444', fontSize: 11, fontWeight: 600 }}>
                        -{stagedDeletions + unstagedDeletions}
                    </Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
                    {stagedCount + unstagedCount} file{(stagedCount + unstagedCount) !== 1 ? 's' : ''} changed
                </Typography>
            </Box>

            <Box sx={{ minHeight: 0, flex: 1, overflow: 'auto' }}>
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
            </Box>
        </Box>
    );
}

export default GitExplorerPanel;
