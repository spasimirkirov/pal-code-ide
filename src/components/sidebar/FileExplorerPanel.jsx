import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tree } from 'react-arborist';
import { FileText, Folder, FolderOpen, RefreshCw } from 'lucide-react';

const runtime = window.palRuntime;

function ExplorerRow({ node, style }) {
    const isFolder = Boolean(node.data?.isDirectory);

    return (
        <div style={style} className="px-1">
            <button
                type="button"
                onClick={() => (isFolder ? node.toggle() : node.select())}
                className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${node.isSelected ? 'bg-cyan-300/15 text-cyan-100' : 'text-slate-300 hover:bg-slate-800/70'
                    }`}
            >
                {isFolder ? (
                    node.isOpen ? (
                        <FolderOpen className="h-4 w-4 text-amber-200" />
                    ) : (
                        <Folder className="h-4 w-4 text-amber-200" />
                    )
                ) : (
                    <FileText className="h-4 w-4 text-cyan-200" />
                )}
                <span className="truncate">{node.data.name}</span>
            </button>
        </div>
    );
}

function FileExplorerPanel({ workspaceRoot, onFileOpen }) {
    const [tree, setTree] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const treeHostRef = useRef(null);
    const [treeHeight, setTreeHeight] = useState(560);

    const loadTree = async () => {
        if (!runtime?.listProjectTree) {
            return;
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
    };

    useEffect(() => {
        void loadTree();
    }, [workspaceRoot]);

    useEffect(() => {
        if (!treeHostRef.current) {
            return;
        }

        const observer = new ResizeObserver((entries) => {
            const nextHeight = Math.floor(entries[0]?.contentRect?.height || 560);
            setTreeHeight(Math.max(220, nextHeight));
        });

        observer.observe(treeHostRef.current);
        return () => observer.disconnect();
    }, []);

    const title = useMemo(() => {
        if (!workspaceRoot) {
            return 'Project';
        }

        const parts = workspaceRoot.split(/[/\\]/);
        return parts[parts.length - 1] || workspaceRoot;
    }, [workspaceRoot]);

    const handleSelect = async (node) => {
        if (!node?.data || node.data.isDirectory) {
            return;
        }

        try {
            const response = await runtime.readProjectFile({ path: node.data.path });
            onFileOpen({
                path: response.path,
                content: response.content,
            });
        } catch (nextError) {
            setError(nextError?.message || 'Failed to open file.');
        }
    };

    return (
        <section className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-300">Explorer</h3>
                    <p className="max-w-[220px] truncate text-[11px] text-slate-500">{title}</p>
                </div>
                <button
                    type="button"
                    onClick={() => void loadTree()}
                    className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-1.5 text-slate-300 hover:text-cyan-100"
                    title="Refresh tree"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {error && <p className="px-3 py-2 text-xs text-rose-300">{error}</p>}

            <div ref={treeHostRef} className="min-h-0 flex-1 px-1 py-2">
                <Tree
                    data={tree}
                    rowHeight={32}
                    openByDefault={false}
                    width="100%"
                    height={treeHeight}
                    disableDrag
                    onSelect={(nodes) => {
                        if (nodes.length) {
                            void handleSelect(nodes[0]);
                        }
                    }}
                >
                    {ExplorerRow}
                </Tree>
            </div>
        </section>
    );
}

export default FileExplorerPanel;
