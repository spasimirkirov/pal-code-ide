import React from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { GitCompareArrows } from 'lucide-react';

function GitDiffPanel({ filePath, original, modified }) {
    return (
        <div className="flex h-full flex-col overflow-hidden bg-[#0f1319]">
            <div className="flex h-8 items-center justify-between border-b border-slate-800 px-3">
                <div className="flex items-center gap-2 text-cyan-100">
                    <GitCompareArrows className="h-4 w-4" />
                    <h2 className="text-xs font-semibold tracking-[0.08em]">Git Diff</h2>
                </div>
                <div className="max-w-[65%] truncate text-xs text-slate-400" title={filePath || ''}>
                    {filePath || 'No file selected'}
                </div>
            </div>

            <div className="min-h-0 flex-1">
                <DiffEditor
                    height="100%"
                    original={original || ''}
                    modified={modified || ''}
                    language="javascript"
                    theme="vs-dark"
                    options={{
                        renderSideBySide: true,
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        automaticLayout: true,
                    }}
                />
            </div>
        </div>
    );
}

export default GitDiffPanel;
