import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';

const parseDiffLines = (diffText) => {
    if (!diffText) return [];
    const lines = diffText.split('\n');
    const hunks = [];
    let currentHunk = null;

    for (const line of lines) {
        if (line.startsWith('@@')) {
            if (currentHunk) hunks.push(currentHunk);
            const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            currentHunk = { header: line, lines: [], lineNum: match ? parseInt(match[1], 10) : 1 };
            continue;
        }
        if (!currentHunk) {
            if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff --git') || line.startsWith('index')) continue;
            continue;
        }
        const type = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
        currentHunk.lines.push({ text: line, type });
    }
    if (currentHunk) hunks.push(currentHunk);
    return hunks;
};

function DiffViewer({ diff, filePath }) {
    const hunks = useMemo(() => parseDiffLines(diff), [diff]);
    const changeCount = useMemo(() => {
        let adds = 0, dels = 0;
        for (const hunk of hunks) {
            for (const line of hunk.lines) {
                if (line.type === 'add') adds++;
                else if (line.type === 'del') dels++;
            }
        }
        return { adds, dels };
    }, [hunks]);

    if (!diff || hunks.length === 0) {
        return <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>No diff available</Typography>;
    }

    return (
        <Box sx={{ mt: 1, borderRadius: '6px', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Box sx={{ px: 1, py: 0.5, bgcolor: 'rgba(2,6,16,0.6)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 600, color: 'text.secondary' }}>
                    {filePath || 'Diff'}
                </Typography>
                {changeCount.adds > 0 && (
                    <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#4ade80' }}>+{changeCount.adds}</Typography>
                )}
                {changeCount.dels > 0 && (
                    <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#fb7185' }}>-{changeCount.dels}</Typography>
                )}
            </Box>
            {hunks.map((hunk, hIdx) => (
                <Box key={hIdx}>
                    <Typography
                        variant="caption"
                        sx={{ display: 'block', px: 1, py: 0.25, fontSize: '0.6rem', fontFamily: 'monospace', color: 'rgba(148,163,184,0.6)', bgcolor: 'rgba(2,6,16,0.3)' }}
                    >
                        {hunk.header}
                    </Typography>
                    {hunk.lines.map((line, lIdx) => (
                        <Box
                            key={lIdx}
                            sx={{
                                px: 1, py: 0.125,
                                fontFamily: '"JetBrains Mono", monospace', fontSize: '0.65rem', lineHeight: 1.5,
                                whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis',
                                bgcolor: line.type === 'add' ? 'rgba(74,222,128,0.06)' : line.type === 'del' ? 'rgba(251,113,133,0.06)' : 'transparent',
                                color: line.type === 'add' ? '#4ade80' : line.type === 'del' ? '#fb7185' : 'rgba(148,163,184,0.8)',
                                '&:hover': { bgcolor: 'rgba(148,163,184,0.04)' },
                            }}
                        >
                            {line.text}
                        </Box>
                    ))}
                </Box>
            ))}
        </Box>
    );
}

export default DiffViewer;
