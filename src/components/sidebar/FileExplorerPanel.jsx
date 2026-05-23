import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tree } from 'react-arborist';
import {
    FilePlus2, FileText, Folder, FolderOpen, FolderPlus, RefreshCw,
    Braces, Code2, FileJson, FileType, Film, Image, Terminal,
    Package, LucideFile, FileCode, FileSpreadsheet, Lock,
} from 'lucide-react';

const runtime = window.palRuntime;
const electronAPI = window.electronAPI;

const toPortablePath = (value) => String(value || '').replace(/\\/g, '/');

const FILE_ICON_MAP = [
    { exts: ['.js', '.mjs', '.cjs'], icon: Braces, color: 'text-yellow-300' },
    { exts: ['.jsx', '.tsx'], icon: Code2, color: 'text-sky-300' },
    { exts: ['.ts'], icon: FileCode, color: 'text-blue-300' },
    { exts: ['.json', '.jsonc', '.json5'], icon: FileJson, color: 'text-orange-300' },
    { exts: ['.css', '.scss', '.less', '.sass'], icon: FileType, color: 'text-pink-300' },
    { exts: ['.html', '.htm', '.xhtml'], icon: LucideFile, color: 'text-red-300' },
    { exts: ['.md', '.mdx', '.txt'], icon: FileText, color: 'text-slate-300' },
    { exts: ['.py'], icon: Braces, color: 'text-yellow-300' },
    { exts: ['.java'], icon: Code2, color: 'text-orange-300' },
    { exts: ['.go'], icon: Code2, color: 'text-cyan-300' },
    { exts: ['.rs'], icon: Code2, color: 'text-orange-300' },
    { exts: ['.rb'], icon: Code2, color: 'text-red-300' },
    { exts: ['.php'], icon: Code2, color: 'text-indigo-300' },
    { exts: ['.c', '.cpp', '.h', '.hpp'], icon: Code2, color: 'text-blue-300' },
    { exts: ['.cs'], icon: Code2, color: 'text-green-300' },
    { exts: ['.swift'], icon: Code2, color: 'text-orange-300' },
    { exts: ['.kt', '.kts'], icon: Code2, color: 'text-purple-300' },
    { exts: ['.sh', '.bash', '.zsh', '.ps1', '.bat'], icon: Terminal, color: 'text-green-300' },
    { exts: ['.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf'], icon: FileSpreadsheet, color: 'text-slate-300' },
    { exts: ['.xml', '.svg'], icon: LucideFile, color: 'text-orange-300' },
    { exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'], icon: Image, color: 'text-purple-300' },
    { exts: ['.mp4', '.mov', '.avi', '.webm'], icon: Film, color: 'text-rose-300' },
    { exts: ['.pdf'], icon: FileSpreadsheet, color: 'text-red-300' },
    { exts: ['.zip', '.tar', '.gz', '.7z', '.rar'], icon: Package, color: 'text-amber-300' },
    { exts: ['.lock'], icon: Lock, color: 'text-slate-400' },
    { exts: ['.env', '.env.example'], icon: Lock, color: 'text-yellow-300' },
];

const getFileIcon = (name) => {
    const lower = name.toLowerCase();
    for (const { exts, icon, color } of FILE_ICON_MAP) {
        for (const ext of exts) {
            if (lower.endsWith(ext)) return { icon, color };
        }
    }
    return { icon: FileText, color: 'text-cyan-200' };
};

const getNodeParentPath = (nodeData, workspaceRoot) => {
    if (!nodeData?.path) {
        return workspaceRoot;
    }

    if (nodeData.isDirectory) {
        return nodeData.path;
    }

    const relativePath = String(nodeData.relativePath || '').replace(/\\/g, '/');
    if (relativePath.includes('/')) {
        return relativePath.split('/').slice(0, -1).join('/');
    }

    const normalizedWorkspace = toPortablePath(workspaceRoot).replace(/\/+$/, '');
    const normalizedAbsolute = toPortablePath(nodeData.path);
    const lastSlash = normalizedAbsolute.lastIndexOf('/');
    if (lastSlash <= 0) {
        return workspaceRoot;
    }

    const parentAbsolute = normalizedAbsolute.slice(0, lastSlash);
    if (normalizedWorkspace && parentAbsolute.toLowerCase().startsWith(normalizedWorkspace.toLowerCase())) {
        return parentAbsolute.slice(normalizedWorkspace.length + 1);
    }

    return parentAbsolute;
};

function ExplorerRow({ node, style, onPreviewFile, onOpenFile, onSelectNode, onContextMenuNode }) {
    const isFolder = Boolean(node.data?.isDirectory);
    const isEditing = Boolean(node.isEditing);
    const editInputRef = useRef(null);
    const { icon: FileIcon, color: iconColor } = isFolder
        ? { icon: node.isOpen ? FolderOpen : Folder, color: 'text-amber-200' }
        : getFileIcon(node.data?.name || '');

    useEffect(() => {
        if (isEditing && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [isEditing]);

    const handleSubmitEdit = () => {
        if (!editInputRef.current) return;
        const value = editInputRef.current.value.trim();
        if (!value || value === node.data.name) {
            node.reset();
            return;
        }
        node.submit(value);
    };

    return (
        <div style={style} className="px-1">
            <div
                data-explorer-row="true"
                role="button"
                tabIndex={-1}
                onClick={() => {
                    node.select();
                    onSelectNode?.(node.data || null, node);
                    if (isFolder) {
                        node.toggle();
                        return;
                    }
                    onPreviewFile?.(node);
                }}
                onDoubleClick={() => {
                    if (isFolder) return;
                    node.select();
                    onSelectNode?.(node.data || null, node);
                    onOpenFile?.(node);
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenuNode?.(event, node.data || null, node);
                }}
                className={`flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm ${node.isSelected ? 'bg-cyan-300/15 text-cyan-100' : 'text-slate-300 hover:bg-slate-800/70'} ${isEditing ? 'bg-slate-800/90' : ''}`}
            >
                {isFolder ? (
                    node.isOpen ? (
                        <FolderOpen className={`h-4 w-4 shrink-0 ${iconColor}`} />
                    ) : (
                        <Folder className={`h-4 w-4 shrink-0 ${iconColor}`} />
                    )
                ) : (
                    <FileIcon className={`h-4 w-4 shrink-0 ${iconColor}`} />
                )}
                {isEditing ? (
                    <input
                        ref={editInputRef}
                        defaultValue={node.data.name}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                handleSubmitEdit();
                            }
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                node.reset();
                            }
                        }}
                        onBlur={handleSubmitEdit}
                        onClick={(event) => event.stopPropagation()}
                        className="min-w-0 flex-1 rounded border border-cyan-500/60 bg-slate-950 px-1.5 py-0.5 text-sm text-slate-100 outline-none"
                    />
                ) : (
                    <span className="truncate">{node.data.name}</span>
                )}
            </div>
        </div>
    );
}

function FileExplorerPanel({ workspaceRoot, onFileOpen, onPathDeleted }) {
    const [tree, setTree] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedNodeData, setSelectedNodeData] = useState(null);
    const [clipboardState, setClipboardState] = useState(null);
    const [isCreating, setIsCreating] = useState(null);
    const [newItemName, setNewItemName] = useState('');
    const [contextMenuState, setContextMenuState] = useState({
        visible: false,
        x: 0,
        y: 0,
        targetNode: null,
        targetTreeNode: null,
    });
    const [selectedTreeNode, setSelectedTreeNode] = useState(null);
    const treeHostRef = useRef(null);
    const contextMenuRef = useRef(null);
    const createInputRef = useRef(null);
    const treeRef = useRef(null);
    const [treeHeight, setTreeHeight] = useState(560);
    const openIdsRef = useRef(null);
    const diskChangeTimerRef = useRef(null);

    const refreshFileTree = useCallback(async () => {
        if (!runtime?.listProjectTree) {
            return;
        }

        if (treeRef.current?.api?.getOpenIds) {
            openIdsRef.current = treeRef.current.api.getOpenIds();
        }

        setLoading(true);
        setError('');
        try {
            const response = await runtime.listProjectTree();
            setTree(response?.tree || []);
        } catch (nextError) {
            setError(nextError?.message || 'Failed to load project tree.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (openIdsRef.current && openIdsRef.current.size > 0 && treeRef.current?.api?.setOpenIds) {
            treeRef.current.api.setOpenIds([...openIdsRef.current]);
            openIdsRef.current = null;
        }
    }, [tree]);

    const handleRename = useCallback(async ({ name, id, node }) => {
        if (!name || !id || !runtime?.workspaceRenamePath) return;
        try {
            const result = await runtime.workspaceRenamePath({
                path: node?.data?.path,
                name,
            });
            if (!result?.ok) {
                setError(result?.error?.message || 'Rename failed.');
            }
            await refreshFileTree();
        } catch (nextError) {
            setError(nextError?.message || 'Rename failed.');
        }
    }, [refreshFileTree]);

    useEffect(() => {
        void refreshFileTree();
    }, [workspaceRoot, refreshFileTree]);

    useEffect(() => {
        if (!electronAPI?.onDiskChanged) {
            return undefined;
        }

        const unsubscribe = electronAPI.onDiskChanged(() => {
            if (diskChangeTimerRef.current) {
                clearTimeout(diskChangeTimerRef.current);
            }
            diskChangeTimerRef.current = setTimeout(() => {
                void refreshFileTree();
            }, 300);
        });

        return () => {
            unsubscribe?.();
            if (diskChangeTimerRef.current) {
                clearTimeout(diskChangeTimerRef.current);
            }
        };
    }, [workspaceRoot, refreshFileTree]);

    useEffect(() => {
        if (!treeHostRef.current) {
            return undefined;
        }

        const observer = new ResizeObserver((entries) => {
            const nextHeight = Math.floor(entries[0]?.contentRect?.height || 560);
            setTreeHeight(Math.max(220, nextHeight));
        });

        observer.observe(treeHostRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!contextMenuState.visible) {
            return undefined;
        }

        const handlePointerDown = (event) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
                setContextMenuState((current) => ({ ...current, visible: false }));
            }
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setContextMenuState((current) => ({ ...current, visible: false }));
            }
        };

        window.addEventListener('pointerdown', handlePointerDown, true);
        window.addEventListener('keydown', handleEscape, true);

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown, true);
            window.removeEventListener('keydown', handleEscape, true);
        };
    }, [contextMenuState.visible]);

    useEffect(() => {
        if (isCreating && createInputRef.current) {
            createInputRef.current.focus();
            createInputRef.current.select();
        }
    }, [isCreating]);

    const title = useMemo(() => {
        if (!workspaceRoot) {
            return 'Project';
        }

        const parts = workspaceRoot.split(/[/\\]/);
        return parts[parts.length - 1] || workspaceRoot;
    }, [workspaceRoot]);

    const openFile = async (node, mode = 'open') => {
        if (!node?.data || node.data.isDirectory) {
            return;
        }

        try {
            const response = await runtime.readProjectFile({ path: node.data.path });
            onFileOpen({
                path: response.path,
                content: response.content,
                mode,
            });
        } catch (nextError) {
            setError(nextError?.message || 'Failed to open file.');
        }
    };

    const resolveTargetDirectoryPath = (nodeData) => {
        const selected = nodeData || selectedNodeData;
        if (!selected?.path) {
            return workspaceRoot;
        }

        return getNodeParentPath(selected, workspaceRoot);
    };

    const startCreating = (type) => {
        setIsCreating(type);
        setNewItemName(type === 'folder' ? 'new-folder' : 'new-file');
        setError('');

        if (selectedTreeNode?.data?.isDirectory && typeof selectedTreeNode.toggle === 'function' && !selectedTreeNode.isOpen) {
            selectedTreeNode.toggle();
        }
    };

    const cancelCreating = () => {
        setIsCreating(null);
        setNewItemName('');
    };

    const createPath = async (type, baseNode = null, explicitName = '', baseTreeNode = null) => {
        if (!runtime?.workspaceCreatePath) {
            setError('workspaceCreatePath is unavailable. Restart the app to reload runtime handlers.');
            return;
        }

        const isFolder = type === 'folder';
        const nextName = String(explicitName || newItemName || '').trim();
        if (!nextName) {
            return;
        }

        const result = await runtime.workspaceCreatePath({
            parentPath: resolveTargetDirectoryPath(baseNode),
            name: nextName,
            type,
        });

        if (!result?.ok) {
            setError(result?.error?.message || 'Create operation failed.');
            return;
        }

        if (baseTreeNode?.data?.isDirectory && typeof baseTreeNode.toggle === 'function' && !baseTreeNode.isOpen) {
            baseTreeNode.toggle();
        }

        cancelCreating();
        await refreshFileTree();
        if (!isFolder) {
            await openFile({ data: { path: result.path, isDirectory: false } }, 'open');
        }
    };

    const renamePath = (nodeData, treeNode) => {
        if (!runtime?.workspaceRenamePath) {
            setError('workspaceRenamePath is unavailable. Restart the app to reload runtime handlers.');
            return;
        }

        if (treeNode) {
            treeNode.edit();
        } else if (treeRef.current?.api?.edit) {
            treeRef.current.api.edit(nodeData.id || nodeData.relativePath);
        }
    };

    const deletePath = async (nodeData) => {
        if (!runtime?.workspaceDeleteFile) {
            setError('workspaceDeleteFile is unavailable. Restart the app to reload runtime handlers.');
            return;
        }

        const confirmed = window.confirm(`Delete ${nodeData.isDirectory ? 'folder' : 'file'} "${nodeData.name}"?`);
        if (!confirmed) {
            return;
        }

        const result = await runtime.workspaceDeleteFile({ path: nodeData.path });
        if (!result?.ok) {
            setError(result?.error?.message || 'Delete failed.');
            return;
        }

        onPathDeleted?.({
            path: nodeData.path,
            isDirectory: Boolean(nodeData?.isDirectory),
        });

        await refreshFileTree();
    };

    const handleContextMenu = (event, nodeData, treeNode) => {
        event.preventDefault();
        event.stopPropagation();

        const menuWidth = 208;
        const estimatedMenuHeight = 320;
        const nextX = Math.min(
            Math.max(8, event.clientX),
            Math.max(8, window.innerWidth - menuWidth - 8),
        );
        const nextY = Math.min(
            Math.max(8, event.clientY),
            Math.max(8, window.innerHeight - estimatedMenuHeight - 8),
        );

        setSelectedNodeData(nodeData || null);
        setSelectedTreeNode(treeNode || null);
        setContextMenuState({
            visible: true,
            x: nextX,
            y: nextY,
            targetNode: nodeData || null,
            targetTreeNode: treeNode || null,
        });
    };

    const handleTreeContextMenu = (event) => {
        const isRowTarget = Boolean(event.target?.closest?.('[data-explorer-row="true"]'));
        if (isRowTarget) {
            return;
        }

        handleContextMenu(
            event,
            {
                path: workspaceRoot,
                name: title,
                isDirectory: true,
                relativePath: '',
            },
            null,
        );
    };

    const handleCopyPath = async (nodeData) => {
        if (runtime?.workspaceCopyText) {
            await runtime.workspaceCopyText({ text: nodeData.path });
        } else if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(nodeData.path);
        }
    };

    const handleCopyRelativePath = async (nodeData) => {
        const relativePath = nodeData.relativePath || nodeData.path;
        if (runtime?.workspaceCopyText) {
            await runtime.workspaceCopyText({ text: relativePath });
        } else if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(relativePath);
        }
    };

    const handleCut = (nodeData) => {
        setClipboardState({
            path: nodeData.path,
            mode: 'cut',
            isCut: true,
        });
    };

    const handleCopy = (nodeData) => {
        setClipboardState({
            path: nodeData.path,
            mode: 'copy',
            isCut: false,
        });
    };

    const handlePaste = async (nodeData) => {
        if (!clipboardState?.path || !runtime?.workspacePastePath) {
            return;
        }

        const result = await runtime.workspacePastePath({
            sourcePath: clipboardState.path,
            targetPath: resolveTargetDirectoryPath(nodeData),
            mode: clipboardState.mode === 'cut' ? 'cut' : 'copy',
        });

        if (!result?.ok) {
            setError(result?.error?.message || 'Paste failed.');
            return;
        }

        if (clipboardState.mode === 'cut') {
            setClipboardState(null);
        }

        await refreshFileTree();
    };

    const handleReveal = async (nodeData) => {
        if (!runtime?.workspaceRevealPath) {
            setError('workspaceRevealPath is unavailable. Restart the app to reload runtime handlers.');
            return;
        }

        const result = await runtime.workspaceRevealPath({ path: nodeData.path });
        if (!result?.ok) {
            setError(result?.error?.message || 'Unable to reveal in file explorer.');
        }
    };

    const menuNodeData = contextMenuState.targetNode || selectedNodeData;
    const isRootContext = Boolean(menuNodeData?.path) && toPortablePath(menuNodeData.path) === toPortablePath(workspaceRoot);
    const pasteEnabled = Boolean(clipboardState?.path);
    const isCreatingFile = isCreating === 'file';
    const isCreatingFolder = isCreating === 'folder';

    const handleCreateFromMenu = async (type, baseNode = null, baseTreeNode = null) => {
        setContextMenuState((current) => ({ ...current, visible: false }));

        const targetName = type === 'folder' ? 'Untitled Folder' : 'Untitled File';
        await createPath(type, baseNode, targetName, baseTreeNode);
    };

    return (
        <section className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-300">Explorer</h3>
                    <p className="max-w-[220px] truncate text-[11px] text-slate-500">{title}</p>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => startCreating('file')}
                        disabled={!runtime?.workspaceCreatePath}
                        className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-1.5 text-slate-300 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                        title="New File"
                    >
                        <FilePlus2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => startCreating('folder')}
                        disabled={!runtime?.workspaceCreatePath}
                        className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-1.5 text-slate-300 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                        title="New Folder"
                    >
                        <FolderPlus className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => void refreshFileTree()}
                        className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-1.5 text-slate-300 hover:text-cyan-100"
                        title="Refresh tree"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {isCreating && (
                <div className="border-b border-edge px-3 py-2">
                    <div className="flex items-center gap-2">
                        <input
                            ref={createInputRef}
                            value={newItemName}
                            onChange={(event) => setNewItemName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void createPath(isCreating, null, newItemName);
                                }

                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    cancelCreating();
                                }
                            }}
                            placeholder={isCreatingFile ? 'new-file.txt' : 'new-folder'}
                            className="min-w-0 flex-1 rounded-md border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-500/70"
                        />
                        <button
                            type="button"
                            onClick={() => void createPath(isCreating, null, newItemName)}
                            className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                        >
                            Create
                        </button>
                        <button
                            type="button"
                            onClick={cancelCreating}
                            className="rounded-md border border-slate-700/80 bg-slate-900/70 px-3 py-2 text-sm text-slate-300 hover:text-slate-100"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {error && <p className="px-3 py-2 text-xs text-rose-300">{error}</p>}

            <div
                ref={treeHostRef}
                onContextMenu={handleTreeContextMenu}
                onKeyDown={(event) => {
                    if (event.key === 'F2' && selectedNodeData && treeRef.current?.api?.edit) {
                        event.preventDefault();
                        treeRef.current.api.edit(selectedNodeData.id || selectedNodeData.relativePath);
                    }
                }}
                className="min-h-0 flex-1 px-1 py-2"
                tabIndex={-1}
            >
                <Tree
                    ref={treeRef}
                    data={tree}
                    rowHeight={32}
                    openByDefault={false}
                    width="100%"
                    height={treeHeight}
                    disableDrag
                    isEditable
                    onRename={handleRename}
                >
                    {(props) => (
                        <ExplorerRow
                            {...props}
                            onPreviewFile={(node) => {
                                void openFile(node, 'preview');
                            }}
                            onOpenFile={(node) => {
                                void openFile(node, 'open');
                            }}
                            onSelectNode={(nodeData, treeNode) => {
                                setSelectedNodeData(nodeData || null);
                                setSelectedTreeNode(treeNode || null);
                            }}
                            onContextMenuNode={handleContextMenu}
                        />
                    )}
                </Tree>
            </div>

            {contextMenuState.visible && typeof document !== 'undefined'
                ? createPortal(
                    <div
                        ref={contextMenuRef}
                        className="fixed bg-[#1e1e24] border border-zinc-700 rounded-md shadow-2xl py-1.5 w-52 text-sm font-sans text-zinc-200 select-none pointer-events-auto"
                        style={{
                            top: `${contextMenuState.y}px`,
                            left: `${contextMenuState.x}px`,
                            zIndex: 2147483647,
                            minHeight: 'auto',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        <button
                            className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors"
                            onClick={() => { void handleCreateFromMenu('file', menuNodeData, contextMenuState.targetTreeNode); }}
                        >
                            New File
                        </button>
                        <button
                            className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors"
                            onClick={() => { void handleCreateFromMenu('folder', menuNodeData, contextMenuState.targetTreeNode); }}
                        >
                            New Folder
                        </button>
                        {isRootContext ? (
                            <>
                                <div className="border-t border-zinc-700/50 my-1" />
                                <button
                                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors"
                                    onClick={() => { void handleReveal(menuNodeData); setContextMenuState(prev => ({ ...prev, visible: false })); }}
                                >
                                    Open in File Explorer
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="border-t border-zinc-700/50 my-1" />
                                <button
                                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors"
                                    onClick={() => { renamePath(menuNodeData, contextMenuState.targetTreeNode); setContextMenuState(prev => ({ ...prev, visible: false })); }}
                                >
                                    Rename
                                </button>
                                <button
                                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors"
                                    onClick={() => { void handleCopyPath(menuNodeData); setContextMenuState(prev => ({ ...prev, visible: false })); }}
                                >
                                    Copy Path
                                </button>
                                <button
                                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors"
                                    onClick={() => { void handleCopyRelativePath(menuNodeData); setContextMenuState(prev => ({ ...prev, visible: false })); }}
                                >
                                    Copy Relative Path
                                </button>
                                <div className="border-t border-zinc-700/50 my-1" />
                                <button
                                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors"
                                    onClick={() => { handleCut(menuNodeData); setContextMenuState(prev => ({ ...prev, visible: false })); }}
                                >
                                    Cut
                                </button>
                                <button
                                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors"
                                    onClick={() => { handleCopy(menuNodeData); setContextMenuState(prev => ({ ...prev, visible: false })); }}
                                >
                                    Copy
                                </button>
                                <button
                                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors"
                                    onClick={() => { void handlePaste(menuNodeData); setContextMenuState(prev => ({ ...prev, visible: false })); }}
                                >
                                    Paste
                                </button>
                                <div className="border-t border-zinc-700/50 my-1" />
                                <button
                                    className="w-full text-left px-3 py-1.5 hover:bg-zinc-700/50 flex items-center transition-colors text-red-400 hover:text-red-300"
                                    onClick={() => { void deletePath(menuNodeData); setContextMenuState(prev => ({ ...prev, visible: false })); }}
                                >
                                    Delete
                                </button>
                            </>
                        )}
                    </div>,
                    document.body,
                )
                : null}
        </section>
    );
}

export default FileExplorerPanel;
