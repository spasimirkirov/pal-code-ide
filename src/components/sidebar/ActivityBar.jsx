import React from 'react';
import { Database, Files, GitBranch } from 'lucide-react';

const tabs = [
  { id: 'files', label: 'File Explorer', icon: Files },
  { id: 'git', label: 'Source Control', icon: GitBranch },
  { id: 'database', label: 'Database Explorer', icon: Database },
];

function ActivityBar({ activeTab, onChangeTab }) {
  return (
    <aside className="flex w-14 flex-col items-center gap-2 border-r border-edge bg-panelSoft/65 py-3">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChangeTab(tab.id)}
            title={tab.label}
            className={`grid h-10 w-10 place-items-center rounded-xl border transition ${
              active
                ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100'
                : 'border-slate-700/70 bg-slate-900/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="h-4.5 w-4.5" />
          </button>
        );
      })}
    </aside>
  );
}

export default ActivityBar;
