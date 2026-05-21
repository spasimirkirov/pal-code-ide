import React, { useState } from 'react';
import ActivityBar from './ActivityBar';
import FileExplorerPanel from './FileExplorerPanel';
import GitExplorerPanel from './GitExplorerPanel';
import DatabaseExplorerPanel from './DatabaseExplorerPanel';

function SidebarPanel({ workspaceRoot, onFileOpen, onOpenDatabaseTable }) {
  const [activeTab, setActiveTab] = useState('files');

  return (
    <div className="flex h-full overflow-hidden rounded-3xl border border-edge bg-panel/85 shadow-glow">
      <ActivityBar activeTab={activeTab} onChangeTab={setActiveTab} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'files' ? (
          <FileExplorerPanel workspaceRoot={workspaceRoot} onFileOpen={onFileOpen} />
        ) : activeTab === 'git' ? (
          <GitExplorerPanel />
        ) : (
          <DatabaseExplorerPanel onOpenTable={onOpenDatabaseTable} />
        )}
      </div>
    </div>
  );
}

export default SidebarPanel;
