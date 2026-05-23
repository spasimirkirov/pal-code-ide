import React from 'react';
import { Box, IconButton, Tooltip, Chip, Menu, MenuItem, Typography } from '@mui/material';
import { Plus, ChevronDown } from 'lucide-react';

function ChatHeaderBar({ onNewSession, lmStudioModel }) {
    return (
        <Box
            sx={{
                display: 'flex', height: 30, alignItems: 'center', justifyContent: 'space-between',
                px: 1.5, borderBottom: '1px solid', borderColor: 'divider',
                bgcolor: 'rgba(7, 11, 20, 0.5)',
            }}
        >
            <Typography
                variant="caption"
                sx={{ fontWeight: 600, letterSpacing: '0.06em', color: 'text.secondary', fontSize: '0.65rem' }}
            >
                Agent Chat
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Tooltip title="New session" arrow>
                    <IconButton
                        size="small"
                        onClick={onNewSession}
                        sx={{ width: 22, height: 22, borderRadius: 0.75, color: 'text.disabled', '&:hover': { color: 'text.primary', bgcolor: 'rgba(148,163,184,0.1)' } }}
                    >
                        <Plus size={13} />
                    </IconButton>
                </Tooltip>

                <Typography variant="caption" sx={{ fontSize: '0.6rem', lineHeight: 1, color: 'text.disabled' }}>
                    LM Studio{lmStudioModel ? ` · ${lmStudioModel}` : ''}
                </Typography>

                <Tooltip title="All actions auto-approved" arrow>
                    <Box
                        sx={{
                            width: 6, height: 6, borderRadius: '50%',
                            bgcolor: 'success.main', opacity: 0.6, ml: 0.25,
                        }}
                    />
                </Tooltip>
            </Box>
        </Box>
    );
}

export default ChatHeaderBar;
