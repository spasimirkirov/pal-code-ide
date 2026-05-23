import React from 'react';
import {
    Box, Typography, Button, Chip, Accordion, AccordionSummary, AccordionDetails,
    Paper, Stack, Divider, IconButton,
} from '@mui/material';
import {
    Bot, ChevronRight, FileText, LoaderCircle, PencilLine, Search, Sparkles, User, Check, X,
} from 'lucide-react';
import { extractCodeBlocks, parseWorkspaceActionBlocks, shouldAutoApproveAction, stripActionJsonBlocks } from '../../utils/aiHelpers';

function ChatMessageItem({
    message, onApplyCode, workspaceActionState, autoApprovalMode,
    appliedActionIds, onApproveWorkspaceAction, onDenyWorkspaceAction,
}) {
    const isUser = message.role === 'user';
    const visibleText = isUser ? String(message.text || '') : stripActionJsonBlocks(String(message.text || ''));
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

            {/* Message text */}
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
                {visibleText || (message.status === 'streaming' ? 'Working...' : '')}
            </Typography>

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

            {/* Workspace actions */}
            {!isUser && workspaceActions.length > 0 && (
                <Box sx={{ mt: 1.5, p: 1, borderRadius: '8px', bgcolor: 'rgba(2,6,16,0.5)', border: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.6rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'primary.light', mb: 0.75, display: 'block' }}>
                        Actions
                    </Typography>
                    {workspaceActions.map((wa, i) => {
                        const actionKey = wa.actionId || `${message.id}:${i}`;
                        const actionState = workspaceActionState[actionKey] || null;
                        const isApplied = appliedActionIds.includes(wa.actionId);
                        const isTerminal = wa.type === 'terminal-command';
                        const isWebSearch = wa.type === 'web-search';
                        const isDenied = actionState?.status === 'denied';
                        const needsApproval = !isApplied && !isDenied && actionState?.status !== 'running'
                            && (!shouldAutoApproveAction(wa, autoApprovalMode) || isTerminal);

                        return (
                            <Paper
                                key={actionKey}
                                variant="outlined"
                                sx={{
                                    p: 0.75, mb: 0.5, borderRadius: '6px',
                                    borderColor: isApplied ? 'rgba(52,211,153,0.35)' : 'rgba(148,163,184,0.12)',
                                    bgcolor: isApplied ? 'rgba(52,211,153,0.04)' : 'rgba(2,6,16,0.3)',
                                }}
                            >
                                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                            {wa.type === 'create-folder' ? 'Create folder' : wa.type} <Typography component="span" variant="body2" sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>&rarr; {wa.path}</Typography>
                                        </Typography>
                                        {wa.summary && (
                                            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.disabled', display: 'block', mt: 0.125 }}>
                                                {wa.summary}
                                            </Typography>
                                        )}
                                        {(isTerminal && wa.command) || (isWebSearch && wa.query) ? (
                                            <Box sx={{ mt: 0.5, p: 0.75, borderRadius: '4px', bgcolor: 'rgba(0,0,0,0.3)', fontFamily: 'monospace', fontSize: '0.65rem', color: isTerminal ? '#fbbf24' : '#2bd1ff', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                {isTerminal ? wa.command : wa.query}
                                            </Box>
                                        ) : null}
                                    </Box>
                                    <Box sx={{ flexShrink: 0 }}>
                                        {needsApproval ? (
                                            <Stack direction="row" spacing={0.25}>
                                                <IconButton
                                                    size="small"
                                                    onClick={() => onApproveWorkspaceAction?.(wa)}
                                                    sx={{ width: 22, height: 22, borderRadius: '4px', color: 'success.main', '&:hover': { bgcolor: 'rgba(52,211,153,0.12)' } }}
                                                >
                                                    <Check size={12} />
                                                </IconButton>
                                                <IconButton
                                                    size="small"
                                                    onClick={() => onDenyWorkspaceAction?.(wa)}
                                                    sx={{ width: 22, height: 22, borderRadius: '4px', color: 'error.main', '&:hover': { bgcolor: 'rgba(251,113,133,0.12)' } }}
                                                >
                                                    <X size={12} />
                                                </IconButton>
                                            </Stack>
                                        ) : (
                                            <Chip
                                                label={actionState?.status === 'running' ? 'Applying...' : isDenied ? 'Denied' : isApplied ? 'Done' : 'Auto'}
                                                size="small"
                                                sx={{ height: 18, fontSize: '0.55rem', '& .MuiChip-label': { px: 0.5 } }}
                                                color={isApplied ? 'success' : isDenied ? 'error' : 'default'}
                                                variant="outlined"
                                            />
                                        )}
                                    </Box>
                                </Stack>
                                {actionState?.status === 'error' && (
                                    <Typography variant="caption" sx={{ color: 'error.main', fontSize: '0.65rem', mt: 0.5, display: 'block' }}>
                                        {actionState.detail}
                                    </Typography>
                                )}
                            </Paper>
                        );
                    })}
                </Box>
            )}
        </Box>
    );
}

export default ChatMessageItem;
