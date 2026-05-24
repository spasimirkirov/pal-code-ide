import React, { useState } from 'react';
import {
    Box, Typography, Button, Chip, Accordion, AccordionSummary, AccordionDetails,
    Stack,
} from '@mui/material';
import {
    Bot, Check, ChevronRight, FileDiff, FileText, LoaderCircle, PencilLine, Search, Sparkles, User, X,
} from 'lucide-react';
import { extractCodeBlocks, parseWorkspaceActionBlocks, shouldAutoApproveAction, stripActionJsonBlocks } from '../../utils/aiHelpers';
import DiffViewer from '../DiffViewer';

function ChatMessageItem({
    message, onApplyCode, workspaceActionState, autoApprovalMode,
    appliedActionIds, onApproveWorkspaceAction, onDenyWorkspaceAction,
}) {
    const [diffData, setDiffData] = useState({});
    const [diffLoading, setDiffLoading] = useState({});
    const [diffVisible, setDiffVisible] = useState({});

    const loadDiff = async (actionKey, action) => {
        if (diffData[actionKey] || diffLoading[actionKey]) return;
        setDiffLoading((prev) => ({ ...prev, [actionKey]: true }));
        try {
            const actionPath = String(action?.path || '').trim();
            const patches = Array.isArray(action?.patches) ? action.patches : [];
            let result = null;

            if (actionPath && patches.length > 0) {
                result = await window.projectRuntime?.patchPreviewPatch?.({ path: actionPath, patches });
            } else if (actionPath) {
                result = await window.projectRuntime?.patchCreateDiff?.({ filePath: actionPath });
            }

            if (result?.ok && result.diff) {
                setDiffData((prev) => ({ ...prev, [actionKey]: result.diff }));
            } else {
                setDiffData((prev) => ({ ...prev, [actionKey]: '_error_' }));
            }
        } catch {
            setDiffData((prev) => ({ ...prev, [actionKey]: '_error_' }));
        } finally {
            setDiffLoading((prev) => ({ ...prev, [actionKey]: false }));
        }
    };

    const toggleDiff = (actionKey, action) => {
        if (!diffData[actionKey] && !diffLoading[actionKey]) {
            loadDiff(actionKey, action);
        }
        setDiffVisible((prev) => ({ ...prev, [actionKey]: !prev[actionKey] }));
    };

    const isUser = message.role === 'user';
    const visibleText = isUser ? String(message.text || '') : stripActionJsonBlocks(String(message.text || ''));
    const activityText = String(message.activity || '').trim();
    const codeBlocks = extractCodeBlocks(visibleText);
    const lastCodeBlock = codeBlocks[codeBlocks.length - 1];
    const workspaceActionSource = String(message.rawToolText || message.text || '');
    const nativeWorkspaceActions = Array.isArray(message.workspaceActions) ? message.workspaceActions : [];
    const workspaceActions = isUser ? [] : nativeWorkspaceActions.length ? nativeWorkspaceActions : parseWorkspaceActionBlocks(workspaceActionSource, message.id);
    const executionSteps = Array.isArray(message.executionSteps) ? message.executionSteps : [];
    const runningStepCount = executionSteps.filter((s) => s.status === 'pending').length;
    const doneStepCount = executionSteps.filter((s) => s.status === 'success').length;
    const failedStepCount = executionSteps.filter((s) => s.status === 'error').length;

    return (
        <Box sx={{ px: 1.5, py: 1.25 }}>
            {/* Role indicator */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                <Box
                    sx={{
                        width: 18, height: 18, borderRadius: '6px',
                        display: 'grid', placeItems: 'center',
                        bgcolor: isUser ? 'rgba(148,163,184,0.12)' : 'rgba(43,209,255,0.12)',
                    }}
                >
                    {isUser ? <User size={10} /> : <Bot size={10} style={{ color: '#2bd1ff' }} />}
                </Box>
                <Typography
                    variant="caption"
                    sx={{
                        fontWeight: 600, fontSize: '0.6rem', letterSpacing: '0.08em',
                        textTransform: 'uppercase', color: 'text.disabled',
                    }}
                >
                    {isUser ? 'You' : 'PAL'}
                </Typography>
                {message.status === 'streaming' && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 0.5 }}>
                        <Sparkles size={10} style={{ color: '#2bd1ff' }} />
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'primary.light' }}>
                            streaming
                        </Typography>
                    </Box>
                )}
            </Box>

            {/* Execution steps */}
            {!isUser && executionSteps.length > 0 && (
                <Box sx={{ mb: 1.5 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.disabled' }}>
                            Steps
                        </Typography>
                        {doneStepCount > 0 && <Chip label={`${doneStepCount}`} size="small" sx={{ height: 16, fontSize: '0.55rem', '& .MuiChip-label': { px: 0.5 } }} color="success" variant="outlined" />}
                        {runningStepCount > 0 && <Chip label={`${runningStepCount}`} size="small" sx={{ height: 16, fontSize: '0.55rem', '& .MuiChip-label': { px: 0.5 } }} color="primary" variant="outlined" />}
                        {failedStepCount > 0 && <Chip label={`${failedStepCount}`} size="small" sx={{ height: 16, fontSize: '0.55rem', '& .MuiChip-label': { px: 0.5 } }} color="error" variant="outlined" />}
                    </Stack>
                    {executionSteps.map((step, index) => {
                        const isPending = step.status === 'pending';
                        const stepType = String(step.type || 'read');
                        const stepTitle = stepType === 'search' ? `Searching for ${step.target || 'workspace files'}`
                            : stepType === 'write' ? `Modified ${step.target || 'file'}` : `Read ${step.target || 'file'}`;
                        const StepIcon = stepType === 'search' ? Search : stepType === 'write' ? PencilLine : FileText;
                        return (
                            <Accordion
                                key={step.key || `${message.id}:${index}`}
                                defaultExpanded={isPending}
                                disableGutters
                                sx={{
                                    bgcolor: 'rgba(2,6,16,0.5)', mb: 0.25, borderRadius: '6px',
                                    boxShadow: 'none', '&:before': { display: 'none' },
                                    '&.Mui-expanded': { my: 0, borderRadius: '6px' },
                                }}
                            >
                                <AccordionSummary
                                    expandIcon={<ChevronRight size={11} />}
                                    sx={{
                                        minHeight: 28, px: 1,
                                        '& .MuiAccordionSummary-content': { m: 0, alignItems: 'center', gap: 0.75 },
                                        '& .MuiAccordionSummary-expandIconWrapper.Mui-expanded': { transform: 'rotate(90deg)' },
                                    }}
                                >
                                    {isPending
                                        ? <LoaderCircle size={12} className="animate-spin" style={{ color: '#2bd1ff' }} />
                                        : <StepIcon size={12} style={{ color: '#2bd1ff', opacity: 0.7 }} />
                                    }
                                    <Typography variant="body2" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                        {stepTitle}
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails sx={{ pt: 0, pb: 0.5, pl: 3.25, pr: 1 }}>
                                    <Typography variant="caption" sx={{ wordBreak: 'break-all', color: 'text.disabled', fontSize: '0.65rem' }}>
                                        {step.details || step.target || 'workspace'}
                                    </Typography>
                                </AccordionDetails>
                            </Accordion>
                        );
                    })}
                </Box>
            )}

            {/* Thinking block */}
            {!isUser && message.status === 'streaming' && activityText && (
                <Box
                    sx={{
                        mb: 1, p: 1, borderRadius: '6px',
                        bgcolor: 'rgba(43,209,255,0.06)', border: '1px solid', borderColor: 'rgba(43,209,255,0.2)',
                        display: 'flex', alignItems: 'center', gap: 0.75,
                    }}
                >
                    <LoaderCircle size={12} className="animate-spin" style={{ color: '#2bd1ff' }} />
                    <Typography
                        variant="caption"
                        sx={{
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            color: 'rgba(191,245,255,0.9)', fontSize: '0.7rem', fontFamily: 'monospace',
                        }}
                    >
                        {activityText}
                    </Typography>
                </Box>
            )}

            {!isUser && message.thinking && (
                <Box
                    sx={{
                        mb: 1, p: 1, borderRadius: '6px',
                        bgcolor: 'rgba(168,85,247,0.04)', border: '1px solid', borderColor: 'rgba(168,85,247,0.12)',
                    }}
                >
                    <Typography variant="caption" sx={{ fontSize: '0.55rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(168,85,247,0.6)', mb: 0.5, display: 'block' }}>
                        Thinking
                    </Typography>
                    <Typography
                        variant="caption"
                        sx={{
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            fontFamily: 'monospace', fontSize: '0.7rem', lineHeight: 1.6,
                            color: 'rgba(168,85,247,0.55)', fontStyle: 'italic',
                        }}
                    >
                        {message.thinking}
                    </Typography>
                </Box>
            )}

            {/* Message text */}
            {(visibleText || message.status !== 'streaming') && (
                <Typography
                    component="div"
                    sx={{
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        fontFamily: 'monospace', fontSize: '0.8125rem', lineHeight: 1.65,
                        color: visibleText ? 'rgba(226,232,240,0.92)' : 'text.disabled',
                        '& code': {
                            bgcolor: 'rgba(148,163,184,0.1)', px: 0.5, py: 0.125, borderRadius: '4px',
                            fontSize: '0.75rem', fontFamily: '"JetBrains Mono", monospace',
                        },
                    }}
                >
                    {visibleText}
                </Typography>
            )}

            {/* Code action buttons */}
            {!isUser && lastCodeBlock && (
                <Stack direction="row" spacing={0.75} sx={{ mt: 1.5 }}>
                    <Button
                        size="small"
                        variant="outlined"
                        color="warning"
                        onClick={() => onApplyCode(lastCodeBlock, 'overwrite')}
                        sx={{
                            fontSize: '0.6rem', letterSpacing: '0.06em', textTransform: 'uppercase',
                            py: 0.25, px: 1, borderRadius: '6px', minWidth: 0,
                            borderColor: 'rgba(251,191,36,0.3)', color: '#fbbf24',
                            '&:hover': { borderColor: 'rgba(251,191,36,0.6)', bgcolor: 'rgba(251,191,36,0.08)' },
                        }}
                    >
                        Overwrite Editor
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => onApplyCode(lastCodeBlock, 'insert')}
                        sx={{
                            fontSize: '0.6rem', letterSpacing: '0.06em', textTransform: 'uppercase',
                            py: 0.25, px: 1, borderRadius: '6px', minWidth: 0,
                            borderColor: 'rgba(43,209,255,0.3)', color: '#2bd1ff',
                            '&:hover': { borderColor: 'rgba(43,209,255,0.6)', bgcolor: 'rgba(43,209,255,0.08)' },
                        }}
                    >
                        Inject Into Editor
                    </Button>
                </Stack>
            )}

            {/* Workspace actions — compact highlights like OpenCode */}
            {!isUser && workspaceActions.length > 0 && (
                <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {workspaceActions.map((wa, i) => {
                        const actionKey = wa.actionId || `${message.id}:${i}`;
                        const actionState = workspaceActionState[actionKey] || null;
                        const isApplied = appliedActionIds.includes(wa.actionId);
                        const isTerminal = wa.type === 'terminal-command';
                        const isWebSearch = wa.type === 'web-search';
                        const hasInlinePatches = Array.isArray(wa.patches) && wa.patches.length > 0;
                        const canPreviewDiff = Boolean(wa.path) && (hasInlinePatches || isApplied);
                        const isDenied = actionState?.status === 'denied';
                        const isQueuedAuto = actionState?.status === 'queued';
                        const needsApproval = !isApplied && !isDenied && actionState?.status !== 'running'
                            && (!shouldAutoApproveAction(wa, autoApprovalMode) || isTerminal);
                        const isAutoApprovedAction = !isTerminal && shouldAutoApproveAction(wa, autoApprovalMode);

                        let statusColor = 'rgba(148,163,184,0.25)';
                        let statusText = isAutoApprovedAction ? 'auto' : 'pending';
                        if (isApplied) { statusColor = 'rgba(52,211,153,0.6)'; statusText = 'done'; }
                        if (isDenied) { statusColor = 'rgba(251,113,133,0.6)'; statusText = 'denied'; }
                        if (isQueuedAuto) { statusColor = 'rgba(43,209,255,0.6)'; statusText = 'queued'; }
                        if (actionState?.status === 'running') { statusColor = 'rgba(43,209,255,0.6)'; statusText = '...'; }

                        const typeColors = {
                            'read-file': '#2bd1ff',
                            'search-text': '#2bd1ff',
                            'list-folder': '#2bd1ff',
                            'write-file': '#4ade80',
                            'patch-file': '#4ade80',
                            'delete-file': '#fb7185',
                            'create-folder': '#fbbf24',
                            'patch-search-replace': '#4ade80',
                            'patch-unified-diff': '#4ade80',
                            'patch-rollback': '#fb7185',
                            'terminal-command': '#fbbf24',
                            'web-search': '#a78bfa',
                        };
                        const typeColor = typeColors[wa.type] || 'rgba(148,163,184,0.4)';

                        return (
                            <Box
                                key={actionKey}
                                sx={{
                                    display: 'flex', alignItems: 'center', gap: 0.5,
                                    px: 1, py: 0.5, borderRadius: '4px',
                                    fontSize: '0.7rem', lineHeight: 1.3,
                                    bgcolor: isApplied ? 'rgba(52,211,153,0.06)' : 'rgba(2,6,16,0.35)',
                                    borderLeft: `2px solid ${statusColor}`,
                                    fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace',
                                }}
                            >
                                {/* Type badge */}
                                <Box
                                    component="span"
                                    sx={{
                                        display: 'inline-flex', px: 0.5, py: '1px', borderRadius: '3px',
                                        fontSize: '0.6rem', fontWeight: 600, lineHeight: 1.4,
                                        color: '#0f1319', bgcolor: typeColor, whiteSpace: 'nowrap',
                                    }}
                                >
                                    {(wa.type || '').replace(/-/g, ' ')}
                                </Box>

                                {/* Path */}
                                {wa.path && (
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontSize: '0.65rem', color: 'text.secondary', ml: 0.25,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            flex: 1, minWidth: 0,
                                        }}
                                    >
                                        {wa.path}
                                    </Typography>
                                )}

                                {/* Command / query inline */}
                                {(isTerminal && wa.command) || (isWebSearch && wa.query) ? (
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontSize: '0.6rem', color: isTerminal ? '#fbbf24' : '#a78bfa',
                                            ml: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            flex: 1, minWidth: 0,
                                        }}
                                    >
                                        {isTerminal ? `$ ${wa.command}` : wa.query}
                                    </Typography>
                                ) : null}

                                {/* Summary */}
                                {wa.summary && !wa.path && !isTerminal && !isWebSearch && (
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontSize: '0.6rem', color: 'text.disabled', ml: 0.25,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            flex: 1, minWidth: 0,
                                        }}
                                    >
                                        {wa.summary}
                                    </Typography>
                                )}

                                {/* Status / actions */}
                                <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.25, ml: 'auto' }}>
                                    {needsApproval ? (
                                        <>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                onClick={() => onApproveWorkspaceAction?.(wa)}
                                                sx={{
                                                    minWidth: 0,
                                                    px: 0.75,
                                                    py: 0.1,
                                                    borderRadius: '3px',
                                                    fontSize: '0.55rem',
                                                    lineHeight: 1.2,
                                                    textTransform: 'none',
                                                    borderColor: 'rgba(52,211,153,0.5)',
                                                    color: 'success.light',
                                                    '&:hover': { bgcolor: 'rgba(52,211,153,0.15)', borderColor: 'rgba(52,211,153,0.7)' },
                                                }}
                                            >
                                                <Check size={10} style={{ marginRight: 4 }} />
                                                Apply
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                onClick={() => onDenyWorkspaceAction?.(wa)}
                                                sx={{
                                                    minWidth: 0,
                                                    px: 0.75,
                                                    py: 0.1,
                                                    borderRadius: '3px',
                                                    fontSize: '0.55rem',
                                                    lineHeight: 1.2,
                                                    textTransform: 'none',
                                                    borderColor: 'rgba(251,113,133,0.5)',
                                                    color: 'error.light',
                                                    '&:hover': { bgcolor: 'rgba(251,113,133,0.15)', borderColor: 'rgba(251,113,133,0.7)' },
                                                }}
                                            >
                                                <X size={10} style={{ marginRight: 4 }} />
                                                Skip
                                            </Button>
                                        </>
                                    ) : (
                                        <Typography variant="caption" sx={{ fontSize: '0.55rem', color: statusColor, whiteSpace: 'nowrap' }}>
                                            {actionState?.status === 'running' ? 'running...' : statusText}
                                        </Typography>
                                    )}
                                    {canPreviewDiff && wa.type !== 'terminal-command' && wa.type !== 'web-search' && (
                                        <Box
                                            component="span"
                                            onClick={() => toggleDiff(actionKey, wa)}
                                            sx={{ fontSize: '0.55rem', color: 'text.disabled', cursor: 'pointer', '&:hover': { color: 'primary.light' }, ml: 0.25 }}
                                        >
                                            <FileDiff size={10} style={{ verticalAlign: 'middle' }} />
                                        </Box>
                                    )}
                                    {diffVisible[actionKey] && diffData[actionKey] && diffData[actionKey] !== '_error_' && (
                                        <DiffViewer diffText={diffData[actionKey]} />
                                    )}
                                </Box>
                            </Box>
                        );
                    })}

                </Box>
            )}
        </Box>
    );
}

export default ChatMessageItem;
