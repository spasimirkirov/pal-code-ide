import React, { useState } from 'react';
import ActivityBar from './ActivityBar';
import FileExplorerPanel from './FileExplorerPanel';
import GitExplorerPanel from './GitExplorerPanel';
import DatabaseExplorerPanel from './DatabaseExplorerPanel';
import AiAssistantPanel from './AiAssistantPanel';

function SidebarPanel({ workspaceRoot, onFileOpen, onOpenDatabaseTable, onOpenGitDiff }) {
    const [activeTab, setActiveTab] = useState('files');

    return (
        <div className="flex h-full overflow-hidden bg-[#0f1319]">
            <ActivityBar activeTab={activeTab} onChangeTab={setActiveTab} />
            <div className="min-h-0 flex-1 overflow-hidden">
                {activeTab === 'files' ? (
                    <FileExplorerPanel workspaceRoot={workspaceRoot} onFileOpen={onFileOpen} />
                ) : activeTab === 'git' ? (
                    <GitExplorerPanel onOpenDiff={onOpenGitDiff} />
                ) : activeTab === 'ai' ? (
                    <AiAssistantPanel />
                ) : (
                    <DatabaseExplorerPanel onOpenTable={onOpenDatabaseTable} />
                )}
            </div>
        </div>
    );
}

export default SidebarPanel;
