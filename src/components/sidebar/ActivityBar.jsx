import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { Database, Files, GitBranch, Sparkles } from 'lucide-react';

const tabs = [
    { id: 'files', label: 'File Explorer', icon: Files },
    { id: 'git', label: 'Source Control', icon: GitBranch },
    { id: 'database', label: 'Database Explorer', icon: Database },
    { id: 'ai', label: 'AI Assistant', icon: Sparkles },
];

function ActivityBar({ activeTab, onChangeTab }) {
    return (
        <Box
            sx={{
                display: 'flex', width: 52, flexDirection: 'column', alignItems: 'center',
                gap: 0.75, py: 1.5,
                borderRight: '1px solid', borderColor: 'divider',
                bgcolor: 'rgba(17, 26, 45, 0.65)',
            }}
        >
            {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                    <Tooltip key={tab.id} title={tab.label} placement="right" arrow>
                        <IconButton
                            onClick={() => onChangeTab(tab.id)}
                            size="small"
                            sx={{
                                width: 36, height: 36, borderRadius: 1.5,
                                border: '1px solid',
                                borderColor: active ? 'rgba(43, 209, 255, 0.35)' : 'rgba(51, 65, 85, 0.7)',
                                bgcolor: active ? 'rgba(43, 209, 255, 0.12)' : 'rgba(15, 23, 42, 0.7)',
                                color: active ? 'primary.light' : 'text.secondary',
                                '&:hover': { color: 'text.primary', bgcolor: 'rgba(148, 163, 184, 0.12)' },
                            }}
                        >
                            <Icon size={16} />
                        </IconButton>
                    </Tooltip>
                );
            })}
        </Box>
    );
}

export default ActivityBar;
