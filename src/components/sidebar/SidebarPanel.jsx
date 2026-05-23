import React, { useState } from 'react';
import { Box } from '@mui/material';
import ActivityBar from './ActivityBar';
import FileExplorerPanel from './FileExplorerPanel';
import GitExplorerPanel from './GitExplorerPanel';
import DatabaseExplorerPanel from './DatabaseExplorerPanel';
import AiVendorsPanel from './AiVendorsPanel';

function SidebarPanel({
    workspaceRoot, onFileOpen, onPathDeleted, onOpenDatabaseTable, onOpenGitDiff,
    databaseConnected, databaseName, databaseTables, databaseLoadingTables,
    onRefreshDatabaseTables, onDisconnectDatabase,
    activeTab: activeTabProp, onActiveTabChange,
}) {
    const [internalActiveTab, setInternalActiveTab] = useState('files');
    const activeTab = activeTabProp || internalActiveTab;

    const handleChangeTab = (nextTab) => {
        if (!activeTabProp) setInternalActiveTab(nextTab);
        onActiveTabChange?.(nextTab);
    };

    return (
        <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden', bgcolor: 'background.paper' }}>
            <ActivityBar activeTab={activeTab} onChangeTab={handleChangeTab} />
            <Box sx={{ minHeight: 0, flex: 1, overflow: 'hidden' }}>
                {activeTab === 'files' ? (
                    <FileExplorerPanel workspaceRoot={workspaceRoot} onFileOpen={onFileOpen} onPathDeleted={onPathDeleted} />
                ) : activeTab === 'git' ? (
                    <GitExplorerPanel onOpenDiff={onOpenGitDiff} />
                ) : activeTab === 'ai' ? (
                    <AiVendorsPanel />
                ) : (
                    <DatabaseExplorerPanel
                        connected={databaseConnected} activeDatabase={databaseName}
                        tables={databaseTables} loadingTables={databaseLoadingTables}
                        onRefreshTables={onRefreshDatabaseTables} onOpenTable={onOpenDatabaseTable}
                        onDisconnect={onDisconnectDatabase}
                    />
                )}
            </Box>
        </Box>
    );
}

export default SidebarPanel;
