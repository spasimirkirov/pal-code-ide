import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  Maximize2,
  Minimize2,
  Minus,
  Square,
  X,
} from 'lucide-react';

const runtime = window.palRuntime;

function MenuDropdown({ label, items, onAction }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-slate-300 hover:bg-slate-800/80 hover:text-slate-100"
      >
        {label}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-30 w-52 rounded-lg border border-slate-700/70 bg-slate-900/95 p-1 shadow-2xl">
          {items.map((item) => (
            <button
              key={`${label}-${item.id}`}
              type="button"
              onClick={() => {
                setOpen(false);
                onAction(item.id);
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
            >
              <span>{item.label}</span>
              {item.hint ? <span className="text-slate-500">{item.hint}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IdeTitleBar({
  activeFilePath,
  llamaBusy,
  isRunning,
  isStarting,
  isStopping,
  onToggleLlama,
  onNewFile,
  onOpenDatabaseView,
  onRefreshGit,
  isMaximized,
  onWindowMinimize,
  onWindowToggleMaximize,
  onWindowClose,
}) {
  const menuItems = useMemo(
    () => ({
      File: [
        { id: 'new-file', label: 'New File', hint: 'Ctrl+N' },
        { id: 'open-db', label: 'Open Database Viewer' },
      ],
      Edit: [
        { id: 'cut', label: 'Cut', hint: 'Ctrl+X' },
        { id: 'copy', label: 'Copy', hint: 'Ctrl+C' },
        { id: 'paste', label: 'Paste', hint: 'Ctrl+V' },
      ],
      View: [
        { id: 'toggle-db', label: 'Toggle Database View' },
        { id: 'toggle-max', label: 'Toggle Maximize', hint: 'F11' },
      ],
      Terminal: [
        { id: 'llama-toggle', label: isRunning ? 'Stop Llama Server' : 'Start Llama Server' },
        { id: 'git-refresh', label: 'Refresh Source Control' },
      ],
      Help: [
        { id: 'about', label: 'About PAL IDE' },
      ],
    }),
    [isRunning],
  );

  const handleMenuAction = async (action) => {
    if (action === 'new-file') {
      onNewFile?.();
      return;
    }

    if (action === 'open-db' || action === 'toggle-db') {
      onOpenDatabaseView?.();
      return;
    }

    if (action === 'toggle-max') {
      await onWindowToggleMaximize?.();
      return;
    }

    if (action === 'llama-toggle') {
      await onToggleLlama?.();
      return;
    }

    if (action === 'git-refresh') {
      onRefreshGit?.();
      return;
    }

    if (action === 'about') {
      window.alert('PAL IDE - VSCode-inspired shell with AI runtime integration.');
    }
  };

  return (
    <header
      className="relative z-20 flex h-9 items-center justify-between border-b border-slate-800/80 bg-slate-950/95 px-2"
      style={{ WebkitAppRegion: 'drag' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-cyan-400/20 text-cyan-200"> 
          <Square className="h-3.5 w-3.5" />
        </div>

        <div className="flex items-center gap-0.5">
          {Object.entries(menuItems).map(([label, items]) => (
            <MenuDropdown key={label} label={label} items={items} onAction={handleMenuAction} />
          ))}
        </div>

        <div className="mx-2 hidden h-4 w-px bg-slate-700 md:block" />

        <p className="hidden max-w-[34vw] truncate text-xs text-slate-400 md:block">{activeFilePath || 'Welcome'}</p>
      </div>

      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          type="button"
          onClick={() => void onToggleLlama?.()}
          disabled={llamaBusy || isStarting || isStopping}
          className="rounded-md border border-cyan-300/35 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-60"
        >
          {isStarting ? 'Starting...' : isStopping ? 'Stopping...' : isRunning ? 'Stop Llama' : 'Start Llama'}
        </button>

        <button
          type="button"
          onClick={() => void onWindowMinimize?.()}
          className="grid h-7 w-8 place-items-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
          title="Minimize"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void onWindowToggleMaximize?.()}
          className="grid h-7 w-8 place-items-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => void onWindowClose?.()}
          className="grid h-7 w-8 place-items-center rounded-md text-slate-300 hover:bg-rose-500/85 hover:text-white"
          title="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}

export default IdeTitleBar;
