import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Maximize2,
    Minimize2,
    Minus,
    Square,
    X,
} from 'lucide-react';

const runtime = window.palRuntime;

function MenuDropdown({ label, items, open, onToggle, onAction }) {
    const [openSubmenuId, setOpenSubmenuId] = useState(null);

    useEffect(() => {
        if (!open) {
            setOpenSubmenuId(null);
        }
    }, [open]);

    return (
        <div className="relative" style={{ WebkitAppRegion: 'no-drag' }}>
            <button
                type="button"
                onClick={() => onToggle(label)}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-slate-300 hover:bg-slate-800/80 hover:text-slate-100"
            >
                {label}
                <ChevronDown className="h-3 w-3" />
            </button>

            {open && (
                <div className="absolute left-0 top-8 z-30 w-52 rounded-lg border border-slate-700/70 bg-slate-900/95 p-1 shadow-2xl">
                    {items.map((item) => (
                        item.separator ? (
                            <div key={`${label}-${item.id}`} className="my-1 h-px bg-slate-700/70" />
                        ) : item.submenu ? (
                            <div
                                key={`${label}-${item.id}`}
                                className="relative"
                                onMouseEnter={() => setOpenSubmenuId(item.id)}
                                onFocus={() => setOpenSubmenuId(item.id)}
                            >
                                <button
                                    type="button"
                                    disabled={Boolean(item.disabled)}
                                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${item.disabled
                                        ? 'cursor-not-allowed text-slate-500'
                                        : 'text-slate-200 hover:bg-slate-800'
                                        }`}
                                >
                                    <span>{item.label}</span>
                                    <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                                </button>

                                {openSubmenuId === item.id && !item.disabled && (
                                    <div className="absolute left-full top-0 z-40 ml-1 w-72 rounded-lg border border-slate-700/70 bg-slate-900/95 p-1 shadow-2xl">
                                        {item.submenu.map((subItem) => (
                                            subItem.separator ? (
                                                <div key={`${label}-${item.id}-${subItem.id}`} className="my-1 h-px bg-slate-700/70" />
                                            ) : (
                                                <button
                                                    key={`${label}-${item.id}-${subItem.id}`}
                                                    type="button"
                                                    onClick={() => {
                                                        if (!subItem.disabled) {
                                                            onAction(subItem.id);
                                                        }
                                                    }}
                                                    disabled={Boolean(subItem.disabled)}
                                                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${subItem.disabled
                                                        ? 'cursor-not-allowed text-slate-500'
                                                        : 'text-slate-200 hover:bg-slate-800'
                                                        }`}
                                                    title={subItem.label}
                                                >
                                                    <span className="truncate">{subItem.label}</span>
                                                    {subItem.hint ? <span className="ml-2 shrink-0 text-slate-500">{subItem.hint}</span> : null}
                                                </button>
                                            )
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <button
                                key={`${label}-${item.id}`}
                                type="button"
                                onClick={() => {
                                    if (!item.disabled) {
                                        onAction(item.id);
                                    }
                                }}
                                disabled={Boolean(item.disabled)}
                                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${item.disabled
                                    ? 'cursor-not-allowed text-slate-500'
                                    : 'text-slate-200 hover:bg-slate-800'
                                    }`}
                            >
                                <span>{item.label}</span>
                                {item.hint ? <span className="text-slate-500">{item.hint}</span> : null}
                            </button>
                        )
                    ))}
                </div>
            )}
        </div>
    );
}

function IdeTitleBar({
    activeFilePath,
    onNewFile,
    onOpenDatabaseView,
    recentWorkspaces = [],
    currentWorkspacePath = '',
    onOpenFolder,
    onOpenRecentWorkspace,
    onClearRecentWorkspaces,
    onExitIde,
    onRefreshGit,
    chatVisible,
    onToggleChat,
    onResetLayout,
    isMaximized,
    onWindowMinimize,
    onWindowToggleMaximize,
    onWindowClose,
}) {
    const [openMenu, setOpenMenu] = useState(null);
    const menuContainerRef = useRef(null);

    useEffect(() => {
        const handleOutsidePointer = (event) => {
            if (!menuContainerRef.current) {
                return;
            }

            if (!menuContainerRef.current.contains(event.target)) {
                setOpenMenu(null);
            }
        };

        window.addEventListener('pointerdown', handleOutsidePointer);
        return () => window.removeEventListener('pointerdown', handleOutsidePointer);
    }, []);

    const handleToggleMenu = (label) => {
        setOpenMenu((current) => (current === label ? null : label));
    };

    const formatRecentLabel = (folderPath) => {
        const normalized = String(folderPath || '').trim();
        if (!normalized) {
            return '(unknown)';
        }

        const parts = normalized.split(/[\\/]/).filter(Boolean);
        return parts[parts.length - 1] || normalized;
    };

    const menuItems = useMemo(
        () => ({
            File: [
                { id: 'new-file', label: 'New File', hint: 'Ctrl+N' },
                { id: 'open-folder', label: 'Open Folder...' },
                { id: 'open-recent-separator', separator: true },
                {
                    id: 'open-recent',
                    label: 'Open Recent',
                    submenu: [
                        ...(recentWorkspaces
                            .filter((folderPath) => String(folderPath || '').trim().toLowerCase() !== String(currentWorkspacePath || '').trim().toLowerCase())
                            .length
                            ? recentWorkspaces
                                .filter((folderPath) => String(folderPath || '').trim().toLowerCase() !== String(currentWorkspacePath || '').trim().toLowerCase())
                                .map((folderPath) => ({
                                    id: `open-recent:${encodeURIComponent(folderPath)}`,
                                    label: folderPath,
                                    hint: formatRecentLabel(folderPath),
                                }))
                            : [{ id: 'open-recent-empty', label: 'No recent folders', disabled: true }]),
                        { id: 'open-recent-clear-separator', separator: true },
                        {
                            id: 'open-recent-clear',
                            label: 'Clear Recently Opened',
                            disabled: recentWorkspaces.length === 0,
                        },
                    ],
                },
                { id: 'file-bottom-separator', separator: true },
                { id: 'exit-ide', label: 'Exit IDE', hint: 'Alt+F4' },
            ],
            Edit: [
                { id: 'cut', label: 'Cut', hint: 'Ctrl+X' },
                { id: 'copy', label: 'Copy', hint: 'Ctrl+C' },
                { id: 'paste', label: 'Paste', hint: 'Ctrl+V' },
            ],
            View: [
                { id: 'toggle-db', label: 'Toggle Database View' },
                { id: 'toggle-chat', label: chatVisible ? 'Hide Chat Panel' : 'Show Chat Panel' },
                { id: 'reset-layout', label: 'Reset Layout' },
                { id: 'toggle-max', label: 'Toggle Maximize', hint: 'F11' },
            ],
            Help: [
                { id: 'about', label: 'About PAL IDE' },
            ],
        }),
        [chatVisible, recentWorkspaces, currentWorkspacePath],
    );

    const handleMenuAction = async (action) => {
        setOpenMenu(null);

        if (action === 'new-file') {
            onNewFile?.();
            return;
        }

        if (action === 'toggle-db') {
            onOpenDatabaseView?.();
            return;
        }

        if (action === 'open-folder') {
            await onOpenFolder?.();
            return;
        }

        if (String(action).startsWith('open-recent:')) {
            const encodedPath = String(action).slice('open-recent:'.length);
            const decodedPath = decodeURIComponent(encodedPath);
            await onOpenRecentWorkspace?.(decodedPath);
            return;
        }

        if (action === 'open-recent-clear') {
            await onClearRecentWorkspaces?.();
            return;
        }

        if (action === 'exit-ide') {
            await onExitIde?.();
            return;
        }

        if (action === 'toggle-chat') {
            onToggleChat?.();
            return;
        }

        if (action === 'reset-layout') {
            onResetLayout?.();
            return;
        }

        if (action === 'toggle-max') {
            await onWindowToggleMaximize?.();
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

                <div ref={menuContainerRef} className="flex items-center gap-0.5">
                    {Object.entries(menuItems).map(([label, items]) => (
                        <MenuDropdown
                            key={label}
                            label={label}
                            items={items}
                            open={openMenu === label}
                            onToggle={handleToggleMenu}
                            onAction={handleMenuAction}
                        />
                    ))}
                </div>

                <div className="mx-2 hidden h-4 w-px bg-slate-700 md:block" />

                <p className="hidden max-w-[34vw] truncate text-xs text-slate-400 md:block">{activeFilePath || 'Welcome'}</p>
            </div>

            <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
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
