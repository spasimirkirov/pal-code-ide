import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { ArrowUp, Square } from 'lucide-react';

function ChatComposer({ prompt, onPromptChange, onPromptKeyDown, onSubmit, onCancel, isSending }) {
    const canSend = Boolean(prompt.trim());

    return (
        <Box
            component="form"
            onSubmit={onSubmit}
            sx={{
                borderTop: '1px solid', borderColor: 'divider',
                bgcolor: 'rgba(7, 11, 20, 0.6)', p: 1.5, pt: 1,
            }}
        >
            <Box sx={{ position: 'relative' }}>
                <Box
                    component="textarea"
                    value={prompt}
                    onChange={(e) => onPromptChange(e.target.value)}
                    onKeyDown={onPromptKeyDown}
                    placeholder="Ask PAL to generate, refactor, or patch code..."
                    rows={3}
                    sx={{
                        width: '100%', resize: 'vertical',
                        minHeight: 72, maxHeight: 200,
                        px: 1.5, py: 1.25, pr: 5,
                        borderRadius: '10px',
                        border: '1px solid', borderColor: 'rgba(148,163,184,0.15)',
                        bgcolor: 'rgba(2, 6, 16, 0.85)',
                        color: 'rgba(226,232,240,0.92)',
                        fontSize: '0.8125rem', lineHeight: 1.5,
                        fontFamily: '"Space Grotesk", sans-serif',
                        outline: 'none',
                        transition: 'border-color 0.15s',
                        '&:hover': { borderColor: 'rgba(148,163,184,0.25)' },
                        '&:focus': { borderColor: 'rgba(43,209,255,0.4)' },
                        '&::placeholder': { color: 'rgba(148,163,184,0.35)', opacity: 1 },
                        '&::-webkit-scrollbar': { width: 4 },
                        '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(148,163,184,0.2)', borderRadius: 2 },
                    }}
                />
                <IconButton
                    type={isSending ? 'button' : 'submit'}
                    onClick={isSending ? onCancel : undefined}
                    disabled={!isSending && !canSend}
                    size="small"
                    sx={{
                        position: 'absolute', bottom: 6, right: 6,
                        width: 28, height: 28,
                        bgcolor: isSending
                            ? 'rgba(239,68,68,0.9)'
                            : canSend
                                ? 'rgba(43,209,255,0.85)'
                                : 'rgba(148,163,184,0.15)',
                        color: isSending
                            ? '#fff'
                            : canSend
                                ? '#05070e'
                                : 'rgba(148,163,184,0.4)',
                        borderRadius: '8px',
                        transition: 'all 0.15s',
                        '&:hover': {
                            bgcolor: isSending ? 'rgba(220,38,38,0.95)' : 'primary.light',
                            color: isSending ? '#fff' : '#05070e',
                        },
                        '&.Mui-disabled': { bgcolor: 'rgba(148,163,184,0.08)', color: 'rgba(148,163,184,0.25)' },
                    }}
                >
                    {isSending ? <Square size={13} /> : <ArrowUp size={15} />}
                </IconButton>
            </Box>
            <Typography
                variant="caption"
                sx={{ mt: 0.5, ml: 0.5, color: 'text.disabled', display: 'block', fontSize: '0.6rem', opacity: 0.5 }}
            >
                {isSending ? 'Click stop to cancel current task' : 'Enter to send • Shift+Enter for newline'}
            </Typography>
        </Box>
    );
}

export default ChatComposer;
