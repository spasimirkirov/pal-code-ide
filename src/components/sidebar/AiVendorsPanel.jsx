import React from 'react';
import { Box, Typography, Card, CardContent, Chip } from '@mui/material';
import { Sparkles } from 'lucide-react';

function AiVendorsPanel({ activeVendor = 'lm-studio' }) {
    return (
        <Box sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" sx={{ color: 'primary.light', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 11, mb: 1 }}>
                AI Provider
            </Typography>
            <Card sx={{ bgcolor: 'rgba(43, 209, 255, 0.06)', border: '1px solid rgba(43, 209, 255, 0.2)', borderRadius: 1.5 }}>
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Sparkles size={18} style={{ color: '#2bd1ff' }} />
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                            LM Studio
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>
                            Local inference provider
                        </Typography>
                    </Box>
                    <Chip label="Active" size="small" sx={{ height: 20, fontSize: '0.6rem', bgcolor: 'rgba(74, 222, 128, 0.15)', color: 'success.light', fontWeight: 600 }} />
                </CardContent>
            </Card>
        </Box>
    );
}

export default AiVendorsPanel;
