import {
    AUTO_CONTEXT_MAX_CHARS,
    AUTO_CONTEXT_MAX_FILES,
    FILE_CONTEXT_HINT_REGEX,
    FILE_REFERENCE_REGEX,
} from '../config/aiConfig';

const getRuntime = () => globalThis?.window?.palRuntime;

export const normalizeModelId = (value) => {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    return text.split(/[\\/]/).pop() || text;
};

export const consumeThinkChunk = (state, chunkText, isFinal = false) => {
    const nextState = state || {
        inThink: false,
        pending: '',
    };

    nextState.pending = `${nextState.pending || ''}${String(chunkText || '')}`;
    let visibleDelta = '';
    let thinkingDelta = '';

    while (nextState.pending.length) {
        if (!nextState.inThink) {
            const openIndex = nextState.pending.indexOf('<think>');
            if (openIndex >= 0) {
                visibleDelta += nextState.pending.slice(0, openIndex);
                nextState.pending = nextState.pending.slice(openIndex + '<think>'.length);
                nextState.inThink = true;
                continue;
            }
        } else {
            const closeIndex = nextState.pending.indexOf('</think>');
            if (closeIndex >= 0) {
                thinkingDelta += nextState.pending.slice(0, closeIndex);
                nextState.pending = nextState.pending.slice(closeIndex + '</think>'.length);
                nextState.inThink = false;
                continue;
            }
        }

        if (isFinal) {
            if (nextState.inThink) {
                thinkingDelta += nextState.pending;
            } else {
                visibleDelta += nextState.pending;
            }
            nextState.pending = '';
            break;
        }

        const retainLength = Math.min(nextState.pending.length, Math.max('<think>'.length, '</think>'.length) - 1);
        const emitLength = nextState.pending.length - retainLength;
        if (emitLength > 0) {
            const emitText = nextState.pending.slice(0, emitLength);
            if (nextState.inThink) {
                thinkingDelta += emitText;
            } else {
                visibleDelta += emitText;
            }
            nextState.pending = nextState.pending.slice(emitLength);
        }
        break;
    }

    return {
        visibleDelta,
        thinkingDelta,
        state: nextState,
    };
};

export const hashString = (value) => {
    const text = String(value || '');
    let hash = 2166136261;

    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
};

export const resolveLmStudioTargetModel = async (settings) => {
    const runtime = getRuntime();
    const configuredActiveModel = String(settings?.lmStudio?.activeModel || '').trim();
    const configuredCodingModel = String(settings?.roleMappings?.coding || '').trim();

    const preferredCandidates = [
        configuredActiveModel,
        configuredCodingModel,
        normalizeModelId(configuredActiveModel),
        normalizeModelId(configuredCodingModel),
    ].filter(Boolean);

    const dedupedCandidates = [...new Set(preferredCandidates)];
    let availableModels = [];

    try {
        const response = await runtime?.lmStudioGetModels?.({
            endpointUrl: settings?.lmStudio?.endpointUrl,
            port: settings?.lmStudio?.port,
        });
        availableModels = (Array.isArray(response?.models) ? response.models : [])
            .map((entry) => String(entry?.id || '').trim())
            .filter(Boolean);
    } catch {
        availableModels = [];
    }

    if (!availableModels.length) {
        return {
            targetModel: dedupedCandidates[0] || '',
            availableModels,
            selectedFromLiveList: false,
        };
    }

    const availableExact = new Set(availableModels);
    for (const candidate of dedupedCandidates) {
        if (availableExact.has(candidate)) {
            return {
                targetModel: candidate,
                availableModels,
                selectedFromLiveList: true,
            };
        }

        const normalizedCandidate = normalizeModelId(candidate);
        const normalizedMatch = availableModels.find((modelId) => normalizeModelId(modelId) === normalizedCandidate);
        if (normalizedMatch) {
            return {
                targetModel: normalizedMatch,
                availableModels,
                selectedFromLiveList: true,
            };
        }
    }

    return {
        targetModel: availableModels[0],
        availableModels,
        selectedFromLiveList: true,
    };
};

export const isNoModelsLoadedError = (message) =>
    /no models loaded|lms\s+load|invalid_request_error/i.test(String(message || ''));

export const extractReferencedWorkspacePaths = (inputText) => {
    const text = String(inputText || '');
    const pattern = new RegExp(FILE_REFERENCE_REGEX);
    const matches = [];
    let match = pattern.exec(text);

    while (match) {
        const candidate = String(match[1] || '').trim();
        if (candidate && !candidate.startsWith('http://') && !candidate.startsWith('https://')) {
            matches.push(candidate.replace(/^\.\//, ''));
        }
        match = pattern.exec(text);
    }

    if (/\breadme\b/i.test(text)) {
        matches.push('README.md');
    }

    return [...new Set(matches)].slice(0, AUTO_CONTEXT_MAX_FILES);
};

export const normalizeParsedWorkspaceActions = (parsed, messageId, blockIndex) => {
    const source = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.actions)
            ? parsed.actions
            : parsed?.type
                ? [parsed]
                : [];

    return source
        .map((entry, actionIndex) => {
            const type = String(entry?.type || '').trim();
            const actionPath = String(entry?.path || '').trim();
            if (!type) {
                return null;
            }

            const normalized = (() => {
                if (type === 'list-files') {
                    return {
                        type,
                        path: '.',
                        summary: String(entry?.summary || 'List workspace files and folders.'),
                    };
                }

                if (type === 'ls-dir') {
                    const dirPath = String(entry?.path || '').trim();
                    return {
                        type,
                        path: dirPath || '.',
                        page: Math.max(1, Number(entry?.page || 1)),
                        pageSize: Math.min(500, Math.max(20, Number(entry?.pageSize || 200))),
                        summary: String(entry?.summary || 'List directory contents.'),
                    };
                }

                if (type === 'terminal-command') {
                    const command = String(entry?.command || '').trim();
                    if (!command) {
                        return null;
                    }

                    return {
                        type,
                        path: '.',
                        command,
                        shell: String(entry?.shell || 'powershell'),
                        timeoutMs: Number(entry?.timeoutMs || 120000),
                        summary: String(entry?.summary || 'Run a terminal command in the workspace.'),
                    };
                }

                if (type === 'web-search') {
                    const query = String(entry?.query || '').trim();
                    if (!query) {
                        return null;
                    }

                    return {
                        type,
                        path: 'web',
                        query,
                        maxResults: Math.min(12, Math.max(1, Number(entry?.maxResults || 6))),
                        summary: String(entry?.summary || 'Search the web for relevant references.'),
                    };
                }

                if (type === 'fetch-webpage') {
                    const url = String(entry?.url || '').trim();
                    if (!url) {
                        return null;
                    }
                    return {
                        type,
                        path: 'web',
                        url,
                        timeoutMs: Math.min(60000, Math.max(3000, Number(entry?.timeoutMs || 15000))),
                        summary: String(entry?.summary || 'Fetch and extract content from a URL.'),
                    };
                }

                if (type === 'search-text') {
                    const query = String(entry?.query || '').trim();
                    if (!query) {
                        return null;
                    }

                    return {
                        type,
                        path: '.',
                        query,
                        isRegex: Boolean(entry?.isRegex),
                        maxResults: Math.min(200, Math.max(1, Number(entry?.maxResults || 60))),
                        summary: String(entry?.summary || 'Search workspace text for relevant symbols.'),
                    };
                }

                if (type === 'search-paths') {
                    const pattern = String(entry?.pattern || '').trim();
                    if (!pattern) {
                        return null;
                    }
                    return {
                        type,
                        path: '.',
                        pattern,
                        maxResults: Math.min(200, Math.max(1, Number(entry?.maxResults || 60))),
                        summary: String(entry?.summary || 'Search workspace files by name pattern.'),
                    };
                }

                if (type === 'get-errors') {
                    return {
                        type,
                        path: actionPath || '.',
                        summary: String(entry?.summary || 'Collect syntax diagnostics from workspace files.'),
                    };
                }

                if (type === 'write-file') {
                    if (!actionPath) {
                        return null;
                    }
                    return {
                        type,
                        path: actionPath,
                        content: String(entry?.content || ''),
                        summary: String(entry?.summary || 'Apply proposed file rewrite.'),
                    };
                }

                if (type === 'read-file') {
                    if (!actionPath) {
                        return null;
                    }
                    return {
                        type,
                        path: actionPath,
                        summary: String(entry?.summary || 'Read workspace file content.'),
                    };
                }

                if (type === 'delete-file') {
                    if (!actionPath) {
                        return null;
                    }
                    return {
                        type,
                        path: actionPath,
                        summary: String(entry?.summary || 'Delete workspace file or directory.'),
                    };
                }

                if (type === 'patch-file' && Array.isArray(entry?.patches) && entry.patches.length) {
                    if (!actionPath) {
                        return null;
                    }
                    return {
                        type,
                        path: actionPath,
                        patches: entry.patches,
                        summary: String(entry?.summary || 'Apply proposed localized patch.'),
                    };
                }

                // unknown action type — pass through with original props
                const { type: t, path: p, summary: s, ...rest } = entry;
                return {
                    type,
                    path: actionPath || '.',
                    summary: String(entry?.summary || `Execute ${type} action.`),
                    ...rest,
                };
            })();

            if (!normalized) {
                return null;
            }

            const signature = hashString(JSON.stringify(normalized));
            return {
                ...normalized,
                actionId: `${String(messageId || 'message')}:${blockIndex}:${actionIndex}:${signature}`,
            };
        })
        .filter(Boolean);
};

export const parseWorkspaceActionBlocks = (text, messageId = '') => {
    const content = String(text || '');
    const blockMatches = content.matchAll(/```(?:pal-workspace-action|json)\s*([\s\S]*?)```/ig);
    const actions = [];
    let blockIndex = 0;

    for (const blockMatch of blockMatches) {
        const rawBlock = String(blockMatch?.[1] || '').trim();
        if (!rawBlock) {
            blockIndex += 1;
            continue;
        }

        let parsed = null;
        try {
            parsed = JSON.parse(rawBlock);
        } catch {
            const jsonCandidate = rawBlock.match(/\{[\s\S]*\}/);
            if (!jsonCandidate) {
                continue;
            }

            try {
                parsed = JSON.parse(jsonCandidate[0]);
            } catch {
                continue;
            }
        }

        actions.push(...normalizeParsedWorkspaceActions(parsed, messageId, blockIndex));
        blockIndex += 1;
    }

    return actions;
};

export const stripActionJsonBlocks = (text) =>
    String(text || '')
        .replace(/```(?:pal-workspace-action|json)\s*[\s\S]*?```/ig, '')
        .trim();

export const shouldAutoApproveAction = (action, mode) => {
    const policy = String(mode || 'manual');
    const type = String(action?.type || '').trim();
    if (policy === 'all') {
        return type !== 'terminal-command';
    }

    if (policy === 'safe') {
        return type === 'list-files'
            || type === 'ls-dir'
            || type === 'read-file'
            || type === 'search-text'
            || type === 'search-paths'
            || type === 'get-errors'
            || type === 'project-get-metadata'
            || type === 'code-search'
            || type === 'code-find-by-type'
            || type === 'code-find-in-file'
            || type === 'validation-run-all'
            || type === 'validation-run-build'
            || type === 'validation-run-tests';
    }

    return false;
};

export const normalizeWorkspaceActionPath = (actionPath, workspaceRoot) => {
    const rawPath = String(actionPath || '').trim();
    if (!rawPath) {
        return '';
    }

    const unixPath = rawPath.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(String(workspaceRoot || '').replace(/\\/g, '/')) && /^\/[^/]/.test(unixPath)) {
        return unixPath.replace(/^\/+/, '');
    }
    const isAbsolute = /^[A-Za-z]:\//.test(unixPath) || unixPath.startsWith('/');
    if (!isAbsolute) {
        return unixPath.replace(/^\.\//, '');
    }

    const root = String(workspaceRoot || '').trim().replace(/\\/g, '/').replace(/\/$/, '');
    if (!root) {
        return unixPath;
    }

    const lowerRoot = root.toLowerCase();
    const lowerPath = unixPath.toLowerCase();
    const rootPrefix = `${lowerRoot}/`;

    if (lowerPath === lowerRoot) {
        return '';
    }

    if (lowerPath.startsWith(rootPrefix)) {
        return unixPath.slice(root.length + 1);
    }

    return unixPath;
};



export const extractCodeBlocks = (text) => {
    if (!text) {
        return [];
    }

    const blocks = [];
    const regex = /```(?:\w+)?\n([\s\S]*?)```/g;
    let match = regex.exec(text);

    while (match) {
        blocks.push(match[1].trim());
        match = regex.exec(text);
    }

    return blocks.filter(Boolean);
};

const flattenTreeToLines = (nodes, depth = 0, lines = []) => {
    if (!Array.isArray(nodes)) {
        return lines;
    }

    for (const node of nodes) {
        if (lines.length >= PROJECT_CONTEXT_MAX_LINES) {
            break;
        }

        const name = String(node?.name || node?.path || '').trim();
        if (!name) {
            continue;
        }

        const isDirectory = Boolean(node?.isDirectory);
        lines.push(`${'  '.repeat(depth)}- ${name}${isDirectory ? '/' : ''}`);

        if (isDirectory && Array.isArray(node?.children) && lines.length < PROJECT_CONTEXT_MAX_LINES) {
            flattenTreeToLines(node.children, depth + 1, lines);
        }
    }

    return lines;
};

export { flattenTreeToLines };

// ── SEARCH/REPLACE Edit Block Parser ──────────────────────────────────────

const SEARCH_START = /<<<<<<<\s*SEARCH\s*/;
const DIVIDER = /=======\s*/;
const REPLACE_END = />>>>>>>\s*REPLACE\s*/;

/**
 * Parse SEARCH/REPLACE blocks grouped by FILE: / CREATE: / DELETE: markers.
 * Returns [{ type: 'edit'|'create'|'delete', path, search?, replace? }]
 */
export const parseSearchReplaceEditBlocks = (text) => {
    const actions = [];
    const lines = String(text || '').split('\n');
    let i = 0;

    while (i < lines.length) {
        const fileMatch = lines[i].match(/^(FILE|CREATE|DELETE):\s*(.+)/i);
        if (fileMatch) {
            const type = fileMatch[1].toLowerCase();
            const path = fileMatch[2].trim();
            i++;

            if (type === 'delete') {
                actions.push({ type: 'delete', path });
                continue;
            }

            // Parse SEARCH/REPLACE block that follows
            const searchLines = [];
            const replaceLines = [];
            let foundSearch = false;
            let foundDivider = false;
            let foundReplaceEnd = false;

            while (i < lines.length) {
                if (!foundSearch && SEARCH_START.test(lines[i])) {
                    foundSearch = true;
                    i++;
                    continue;
                }
                if (foundSearch && !foundDivider) {
                    if (DIVIDER.test(lines[i])) {
                        foundDivider = true;
                        i++;
                        continue;
                    }
                    searchLines.push(lines[i]);
                    i++;
                    continue;
                }
                if (foundSearch && foundDivider) {
                    if (REPLACE_END.test(lines[i])) {
                        foundReplaceEnd = true;
                        i++;
                        break;
                    }
                    replaceLines.push(lines[i]);
                    i++;
                    continue;
                }
                i++;
            }

            if (foundReplaceEnd) {
                const search = searchLines.join('\n').replace(/\s+$/, '');
                const replace = replaceLines.join('\n').replace(/\s+$/, '');
                actions.push({ type, path, search, replace });
            } else {
                actions.push({ type, path, search: searchLines.join('\n'), replace: replaceLines.join('\n') });
            }
            continue;
        }
        i++;
    }

    return actions;
};

export const buildWorkspaceContext = async ({ promptText, workspaceRoot, traceId }) => {
    const text = String(promptText || '').trim();
    if (!text) {
        return '';
    }

    try {
        const runtime = getRuntime();
        const root = String(workspaceRoot || '').trim();

        let allFlatPaths = [];
        let treeLines = [];

        // Prefer the cached workspace index for fast path listing
        if (runtime?.workspaceIndexPaths) {
            try {
                allFlatPaths = await runtime.workspaceIndexPaths();
            } catch {
                // fall through to tree listing
            }
        }

        if (allFlatPaths.length === 0 && runtime?.workspaceListFiles) {
            const structured = await runtime.workspaceListFiles({ traceId });
            if (structured?.ok && Array.isArray(structured?.tree)) {
                treeLines = flattenTreeToLines(structured.tree);
                const flattenPaths = (nodes) => {
                    if (!Array.isArray(nodes)) return;
                    for (const n of nodes) {
                        if (n.isDirectory) {
                            flattenPaths(n.children);
                        } else if (n.relativePath) {
                            allFlatPaths.push(n.relativePath.replace(/\\/g, '/'));
                        }
                    }
                };
                flattenPaths(structured.tree);
            }
        }

        if (allFlatPaths.length === 0) {
            return '';
        }

        const FLAT_PATH_LIMIT = 200;
        const parts = [`Workspace root: ${root || '(unknown)'}`];

        if (treeLines.length === 0 && allFlatPaths.length > 0) {
            const top = new Set();
            const MAX_TREE_ITEMS = 60;
            const showCount = Math.min(allFlatPaths.length, MAX_TREE_ITEMS);
            for (let i = 0; i < showCount; i++) {
                const parts2 = allFlatPaths[i].split('/');
                if (parts2.length === 1) {
                    top.add(allFlatPaths[i]);
                } else {
                    top.add(parts2[0] + '/');
                }
            }
            treeLines = [...top].sort().slice(0, MAX_TREE_ITEMS);
            treeLines.unshift(`(${allFlatPaths.length} files total; showing ${Math.min(allFlatPaths.length, MAX_TREE_ITEMS)} top-level entries)`);
        }

        if (treeLines.length > 0) {
            parts.push('Workspace tree:', ...treeLines);
        }

        const displayPaths = allFlatPaths.slice(0, FLAT_PATH_LIMIT);
        parts.push(`\nKnown workspace paths (use these exact paths for read-file/write-file/patch-file) — showing ${displayPaths.length} of ${allFlatPaths.length} total:`);
        parts.push(displayPaths.join('\n'));

        return parts.join('\n');
    } catch {
        return '';
    }
};

export const buildReferencedFileContext = async ({ promptText, traceId }) => {
    const runtime = getRuntime();
    const trimmedPrompt = String(promptText || '').trim();
    const shouldTryFileContext = FILE_CONTEXT_HINT_REGEX.test(trimmedPrompt);
    if (!shouldTryFileContext || !runtime?.workspaceReadFile) {
        return {
            hasReferencedFileContext: false,
            referencedContextText: '',
        };
    }

    const referencedPaths = extractReferencedWorkspacePaths(trimmedPrompt);
    if (!referencedPaths.length) {
        return {
            hasReferencedFileContext: false,
            referencedContextText: '',
        };
    }

    const contexts = [];
    let budget = AUTO_CONTEXT_MAX_CHARS;

    for (const referencedPath of referencedPaths) {
        if (budget <= 0) {
            break;
        }

        try {
            // eslint-disable-next-line no-await-in-loop
            const readResult = await runtime.workspaceReadFile({ path: referencedPath, traceId });
            if (!readResult?.ok) {
                continue;
            }

            const content = String(readResult.content || '');
            const chunk = content.slice(0, Math.max(0, budget));
            budget -= chunk.length;

            contexts.push([
                `Path: ${readResult.path || referencedPath}`,
                '```',
                chunk,
                '```',
            ].join('\n'));
        } catch {
            // Skip files that cannot be loaded.
        }
    }

    if (!contexts.length) {
        return {
            hasReferencedFileContext: false,
            referencedContextText: '',
        };
    }

    return {
        hasReferencedFileContext: true,
        referencedContextText: contexts.join('\n\n'),
    };
};
