import fs from 'node:fs';
import path from 'node:path';
import Fuse from 'fuse.js';
import pino from 'pino';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
    normalizeWorkspaceActionPath,
    shouldAutoApproveAction,
    parseWorkspaceActionBlocks,
    stripActionJsonBlocks,
} from '../utils/aiHelpers';
import { SYSTEM_PROMPT, WORKSPACE_TOOLING_PROMPT, CHAT_HISTORY_WINDOW, MAX_CONTEXT_TOKENS } from '../config/aiConfig';
import { createAiSdkService } from './ai-sdk-service';
import { createTaskMemoryStore } from './task-memory-store';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.vite', 'dist', 'out', '.next', '.cache', '__pycache__']);

const normalizeInsideRoot = (rootPath, targetPath) => {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('Path is outside workspace root.');
    }
    return resolvedTarget;
};

const orchestratorTracer = trace.getTracer('pal.ai.orchestrator');


export const createAiOrchestratorService = ({ getMainWindow, getWorkspaceRoot, workspaceIndex, mcpToolsService, projectMetadataService, codeSearchService, patchService, validationService, agentMemoryDbPath }) => {
    const pendingApprovals = new Map();
    const activeSessions = new Map();
    const logger = pino({ name: 'pal-ai-orchestrator', level: process.env.PAL_LOG_LEVEL || 'info' });
    const taskMemory = createTaskMemoryStore({ dbPath: agentMemoryDbPath, logger });

    const emit = (channel, payload) => {
        const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    };

    // ── File Ops ────────────────────────────────────────────────────────

    const BINARY_EXTENSIONS = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.tif', '.avif',
        '.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a',
        '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm',
        '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.ttf', '.otf', '.woff', '.woff2', '.eot',
        '.pyc', '.pyo', '.so', '.dll', '.dylib', '.exe', '.msi', '.app',
        '.o', '.a', '.lib', '.obj',
        '.bin', '.dat', '.db', '.sqlite', '.sqlite3',
        '.DS_Store', '.lnk',
    ]);

    const isBinaryExtension = (filePath) => BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());

    const isBinaryContent = (filePath) => {
        try {
            const fd = fs.openSync(filePath, 'r');
            const buffer = Buffer.alloc(4096);
            const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
            fs.closeSync(fd);
            for (let i = 0; i < bytesRead; i++) {
                if (buffer[i] === 0) return true;
            }
            return false;
        } catch {
            return true;
        }
    };

    const readWorkspaceFile = (relativePath) => {
        const root = getWorkspaceRoot();
        const absPath = normalizeInsideRoot(root, path.resolve(root, relativePath));
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) throw new Error('NOT_A_FILE');

        if (isBinaryExtension(absPath)) {
            const ext = path.extname(absPath).toLowerCase();
            throw new Error(`Cannot read "${path.basename(absPath)}": binary files (.${ext.slice(1)}) are not supported. If this is an image, this model does not support image input — describe the image's purpose to the user instead.`);
        }

        if (isBinaryContent(absPath)) {
            throw new Error(`Cannot read "${path.basename(absPath)}": file appears to be binary. Only text files can be read.`);
        }

        return { path: absPath, content: fs.readFileSync(absPath, 'utf-8') };
    };

    const writeWorkspaceFile = (relativePath, content, backup) => {
        const root = getWorkspaceRoot();
        const absPath = normalizeInsideRoot(root, path.resolve(root, relativePath));
        if (backup && fs.existsSync(absPath)) {
            fs.copyFileSync(absPath, `${absPath}.bak`);
        }
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, content, 'utf-8');
        return { path: absPath };
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const deleteWorkspaceFile = async (relativePath) => {
        const root = getWorkspaceRoot();
        const absPath = normalizeInsideRoot(root, path.resolve(root, relativePath));
        if (!fs.existsSync(absPath)) throw new Error('ENOENT');

        // Windows EPERM race: retry with backoff for newly-created dirs
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                fs.rmSync(absPath, { recursive: true, force: true });
                return { path: absPath };
            } catch (err) {
                if (err.code === 'EPERM' && attempt < 4) {
                    await sleep((attempt + 1) * 50);
                    continue;
                }
                throw err;
            }
        }
        return { path: absPath };
    };

    const patchWorkspaceFile = (relativePath, patches) => {
        const root = getWorkspaceRoot();
        const absPath = normalizeInsideRoot(root, path.resolve(root, relativePath));
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) throw new Error('NOT_A_FILE');
        let content = fs.readFileSync(absPath, 'utf-8');
        const ops = Array.isArray(patches) ? [...patches] : [];
        if (!ops.length) throw new Error('No patch operations provided.');
        ops.sort((a, b) => (b.lineStart || 0) - (a.lineStart || 0));
        for (const op of ops) {
            const lines = content.split('\n');
            const start = Math.max(0, (op.lineStart || 1) - 1);
            const end = Math.min(lines.length, op.lineEnd ? op.lineEnd : start + 1);
            const newLines = String(op.text || '').split('\n');
            lines.splice(start, end - start, ...newLines);
            content = lines.join('\n');
        }
        fs.writeFileSync(absPath, content, 'utf-8');
        return { path: absPath };
    };

    // ── Path Validation ─────────────────────────────────────────────────

    const validatePath = async (rawPath, actionType) => {
        const normalized = String(rawPath || '').replace(/\\/g, '/').toLowerCase().replace(/^\/+|\/+$/g, '');
        if (!normalized) return { ok: false, error: 'Empty path.' };

        const rememberedPath = await taskMemory.getResolvedPath(normalized);
        if (rememberedPath) {
            try {
                const rememberedExists = Boolean(await workspaceIndex.isKnownPath(String(rememberedPath || '').toLowerCase()));
                if (rememberedExists) {
                    return { ok: true, resolvedPath: rememberedPath };
                }
            } catch {
                // Ignore memory lookup errors and continue normal validation flow.
            }
        }

        // Block binary files early with a clear message
        if (actionType !== 'delete-file' && isBinaryExtension(rawPath)) {
            return { ok: false, error: `Cannot read "${path.basename(rawPath)}": binary files (.${path.extname(rawPath).toLowerCase().slice(1)}) are not supported. Only text files can be read.` };
        }

        let exists = false;
        try {
            exists = Boolean(await workspaceIndex.isKnownPath(normalized));
        } catch {
            return { ok: true };
        }

        if (exists) return { ok: true };

        const fileName = normalized.split('/').pop();
        let suggestions = [];
        try { suggestions = await workspaceIndex.findFileByName(fileName); } catch { /* */ }

        if (!suggestions.length && fileName) {
            try {
                const allPaths = await workspaceIndex.getAllPaths();
                const pathIndex = allPaths.map((p) => ({
                    path: p,
                    basename: p.split('/').pop() || p,
                }));
                const fuse = new Fuse(pathIndex, {
                    keys: ['basename', 'path'],
                    threshold: 0.34,
                    distance: 100,
                    includeScore: true,
                });
                suggestions = fuse.search(fileName, { limit: 3 }).map((item) => item.item.path);
            } catch {
                // Ignore fuzzy-search failures; we still return a safe validation error.
            }
        }

        const hint = suggestions.length > 0
            ? ` Did you mean: ${suggestions.slice(0, 3).join(', ')}?`
            : ' Use search-paths or list-files to discover valid paths.';

        const suggestionPath = suggestions.length > 0 ? suggestions[0] : '';

        return { ok: false, error: `Blocked hallucinated path: ${normalized}.${hint}`, suggestionPath };
    };

    // ── Context Builders ────────────────────────────────────────────────

    const buildWorkspaceContext = async (workspaceRoot) => {
        try {
            const allFlatPaths = await workspaceIndex.getAllPaths();
            if (!allFlatPaths.length) return '';

            const parts = [`Workspace root: ${workspaceRoot || '(unknown)'}`];
            const top = new Set();
            const MAX_TREE = 60;
            for (let i = 0; i < Math.min(allFlatPaths.length, MAX_TREE); i++) {
                const segs = allFlatPaths[i].split('/');
                top.add(segs.length === 1 ? allFlatPaths[i] : `${segs[0]}/`);
            }
            const treeLines = [...top].sort();
            treeLines.unshift(`(${allFlatPaths.length} files total)`);
            parts.push('Workspace tree:', ...treeLines);

            const FLAT_LIMIT = 60;
            const display = allFlatPaths.slice(0, FLAT_LIMIT);
            parts.push(`\nKnown workspace paths (use these exact paths for read-file/write-file/patch-file) \u2014 showing ${display.length} of ${allFlatPaths.length} total:`);
            parts.push(display.join('\n'));
            parts.push('\nCRITICAL: Paths like "src/main.js" mean the file IS inside a "src/" subdirectory. When creating NEW files or folders at the workspace root, do NOT add "src/" to the path. Example: to create "experimental" at workspace root, use path "experimental", not "src/experimental".');

            return parts.join('\n');
        } catch { return ''; }
    };

    const extractReferencedPaths = (text) => {
        if (!text) return [];
        const refs = [];
        const regex = /`([^`]+)`/g;
        let m;
        while ((m = regex.exec(text)) !== null) {
            const p = m[1].trim();
            if (p && (p.includes('/') || p.includes('\\')) && !p.startsWith('http')) refs.push(p);
        }
        return [...new Set(refs)];
    };

    const buildReferencedFileContext = async (promptText) => {
        const trimmed = String(promptText || '').trim();
        if (!/read|check|look|show|display|open|fetch|load|get|examine|inspect|view/i.test(trimmed)) {
            return { hasContext: false, contextText: '' };
        }
        const paths = extractReferencedPaths(trimmed);
        if (!paths.length) return { hasContext: false, contextText: '' };

        const MAX_CHARS = 8000;
        const contexts = [];
        let budget = MAX_CHARS;

        for (const refPath of paths) {
            if (budget <= 0) break;
            try {
                const absPath = normalizeInsideRoot(getWorkspaceRoot(), path.resolve(getWorkspaceRoot(), refPath));
                if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) continue;
                if (isBinaryExtension(absPath) || isBinaryContent(absPath)) continue;
                const content = fs.readFileSync(absPath, 'utf-8');
                const chunk = content.slice(0, Math.max(0, budget));
                budget -= chunk.length;
                contexts.push(`Path: ${refPath}\n\`\`\`\n${chunk}\n\`\`\``);
            } catch { /* skip */ }
        }

        if (!contexts.length) return { hasContext: false, contextText: '' };
        return { hasContext: true, contextText: contexts.join('\n\n') };
    };

    // ── Action Execution ────────────────────────────────────────────────

    const resolveFullPath = (actionPath, workspaceRoot) => {
        return normalizeWorkspaceActionPath(actionPath, workspaceRoot);
    };

    const executeAction = async ({ action, traceId }) => {
        const workspaceRoot = getWorkspaceRoot();
        const needsPath = ['read-file', 'write-file', 'patch-file', 'delete-file'].includes(action.type);
        const normalizedPath = needsPath ? resolveFullPath(action.path, workspaceRoot) : '';

        if (needsPath && ['read-file', 'patch-file', 'delete-file'].includes(action.type)) {
            const validation = await validatePath(normalizedPath || action.path, action.type);
            if (validation.ok && validation.resolvedPath && validation.resolvedPath !== action.path) {
                emit('ai:stream-chunk', {
                    traceId,
                    text: `\n[Using remembered path for ${action.type}: ${validation.resolvedPath}]\n`,
                });
                return executeAction({ action: { ...action, path: validation.resolvedPath }, traceId });
            }
            if (!validation.ok) {
                if (validation.suggestionPath) {
                    emit('ai:stream-chunk', {
                        traceId,
                        text: `\n[Retrying ${action.type} with suggested path: ${validation.suggestionPath}]\n`,
                    });
                    await taskMemory.rememberResolvedPath(action.path, validation.suggestionPath);
                    return executeAction({ action: { ...action, path: validation.suggestionPath }, traceId });
                }
                return { ok: false, error: validation.error, pathSafety: true };
            }
        }

        try {
            let result;

            switch (action.type) {
                case 'list-files': {
                    const paths = await workspaceIndex.getAllPaths();
                    const top = new Set();
                    for (const p of paths) {
                        const segs = p.split('/');
                        top.add(segs.length === 1 ? p : `${segs[0]}/`);
                    }
                    result = { ok: true, total: paths.length, tree: [...top].sort().map((name) => ({ id: name, name: name.replace('/', ''), isDirectory: name.endsWith('/'), relativePath: name })) };
                    break;
                }
                case 'ls-dir': {
                    const dirPath = String(action.path || '.').trim();
                    const absDir = normalizeInsideRoot(workspaceRoot, path.resolve(workspaceRoot, dirPath));
                    const entries = fs.readdirSync(absDir, { withFileTypes: true })
                        .filter((e) => !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'))
                        .map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
                    const page = Math.max(1, Number(action.page || 1));
                    const pageSize = Math.max(1, Math.min(500, Number(action.pageSize || 200)));
                    const total = entries.length;
                    const totalPages = Math.ceil(total / pageSize);
                    const start = (page - 1) * pageSize;
                    result = { ok: true, path: dirPath, items: entries.slice(start, start + pageSize), page, totalPages };
                    break;
                }
                case 'read-file': {
                    result = readWorkspaceFile(normalizedPath);
                    if (result.content && result.content.length > 8000) {
                        result.content = result.content.slice(0, 8000) + `\n... [truncated: ${result.content.length - 8000} chars exceeded limit]`;
                    }
                    result.ok = true;
                    break;
                }
                case 'write-file': {
                    result = writeWorkspaceFile(normalizedPath, action.content, true);
                    result.ok = true;
                    break;
                }
                case 'patch-file': {
                    result = patchWorkspaceFile(normalizedPath, action.patches);
                    result.ok = true;
                    break;
                }
                case 'delete-file': {
                    result = await deleteWorkspaceFile(normalizedPath);
                    result.ok = true;
                    break;
                }
                case 'create-folder': {
                    const folderPath = String(action.path || '.');
                    const absFolder = path.isAbsolute(folderPath) ? folderPath : path.resolve(workspaceRoot, folderPath);
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            fs.mkdirSync(absFolder, { recursive: true });
                            result = { ok: true, path: absFolder };
                            break;
                        } catch (err) {
                            if (err.code === 'EPERM' && attempt < 2) {
                                await sleep((attempt + 1) * 50);
                                continue;
                            }
                            throw err;
                        }
                    }
                    break;
                }
                case 'search-text': {
                    const query = String(action.query || '');
                    const isRegex = Boolean(action.isRegex);
                    const maxResults = Math.min(200, Number(action.maxResults || 60));
                    const allPaths = await workspaceIndex.getAllPaths();
                    const matches = [];
                    for (const relPath of allPaths) {
                        if (matches.length >= maxResults) break;
                        try {
                            const absPath = normalizeInsideRoot(workspaceRoot, path.resolve(workspaceRoot, relPath));
                            const content = fs.readFileSync(absPath, 'utf-8');
                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                if (matches.length >= maxResults) break;
                                const matched = isRegex ? new RegExp(query, 'i').test(lines[i]) : lines[i].toLowerCase().includes(query.toLowerCase());
                                if (matched) matches.push({ path: relPath, lineNumber: i + 1, line: lines[i].trim().slice(0, 200) });
                            }
                        } catch { /* skip unreadable */ }
                    }
                    result = { ok: true, matches, resultCount: matches.length };
                    break;
                }
                case 'search-paths': {
                    const pattern = String(action.pattern || '');
                    const maxFind = Math.min(200, Number(action.maxResults || 60));
                    const matches = await workspaceIndex.searchPaths(pattern);
                    result = { ok: true, matches: matches.slice(0, maxFind).map((p) => ({ path: p })), resultCount: matches.length };
                    break;
                }
                case 'get-errors': {
                    const allResults = await validationService?.runAll?.() || {};
                    const errors = [];
                    for (const [kind, res] of Object.entries(allResults)) {
                        if (res?.output) {
                            errors.push({ kind, output: res.output, exitCode: res.exitCode, ok: res.ok });
                        }
                    }
                    result = { ok: true, errors, errorCount: errors.length };
                    break;
                }
                case 'terminal-command': {
                    if (!mcpToolsService) { result = { ok: false, error: 'Terminal service unavailable.' }; break; }
                    const termResult = await mcpToolsService.executeTerminalTool({ command: action.command, shell: action.shell || 'powershell', timeoutMs: Number(action.timeoutMs || 120000) });
                    result = { ok: true, path: 'terminal', terminalResult: termResult };
                    break;
                }
                case 'web-search': {
                    if (!mcpToolsService) { result = { ok: false, error: 'Web search service unavailable.' }; break; }
                    const web = await mcpToolsService.duckduckgoSearch({ query: action.query, maxResults: Math.min(10, Number(action.maxResults || 6)) });
                    result = { ok: true, path: 'web', webResult: web };
                    break;
                }
                // ── Layer 1: Project Metadata ──
                case 'project-get-metadata':
                case 'project_get_metadata': {
                    const meta = projectMetadataService?.getContextSummary?.() || '';
                    result = { ok: true, metadata: meta, raw: projectMetadataService?.getMetadata?.() || {} };
                    break;
                }
                // ── Layer 2: Code Search ──
                case 'code-search':
                case 'code_search': {
                    const query = String(action.query || '');
                    const matches = await codeSearchService?.search?.(query) || [];
                    result = { ok: true, matches, resultCount: matches.length };
                    break;
                }
                case 'code-find-by-type':
                case 'code_find_by_type': {
                    const type = String(action.type || '');
                    const typeMatches = await codeSearchService?.findByType?.(type) || [];
                    result = { ok: true, matches: typeMatches, resultCount: typeMatches.length };
                    break;
                }
                case 'code-find-in-file':
                case 'code_find_in_file': {
                    const filePath = String(action.path || '');
                    const fileMatches = await codeSearchService?.findByFile?.(filePath) || [];
                    result = { ok: true, matches: fileMatches, resultCount: fileMatches.length };
                    break;
                }
                // ── Layer 3: Precision Patching ──
                case 'patch-search-replace':
                case 'patch_search_replace': {
                    const blocks = Array.isArray(action.blocks) ? action.blocks : [];
                    const targetPath = String(action.path || '');
                    result = await patchService?.applySearchReplace?.({ filePath: targetPath, blocks }) || { ok: false, error: 'Patch service unavailable.' };
                    break;
                }
                case 'patch-unified-diff':
                case 'patch_unified_diff': {
                    const diffText = String(action.diff || '');
                    const diffPath = String(action.path || '');
                    result = await patchService?.applyUnifiedDiff?.({ filePath: diffPath, diff: diffText }) || { ok: false, error: 'Patch service unavailable.' };
                    break;
                }
                case 'patch-rollback':
                case 'patch_rollback': {
                    const rollbackPath = String(action.path || '');
                    result = await patchService?.rollback?.({ filePath: rollbackPath }) || { ok: false, error: 'Patch service unavailable.' };
                    break;
                }
                // ── Layer 4: Validation ──
                case 'validation-run-all':
                case 'validation_run_all': {
                    result = await validationService?.runAll?.() || { ok: false, error: 'Validation service unavailable.' };
                    break;
                }
                case 'validation-run-build':
                case 'validation_run_build': {
                    result = await validationService?.runBuild?.() || { ok: false, error: 'Validation service unavailable.' };
                    break;
                }
                case 'validation-run-tests':
                case 'validation_run_tests': {
                    result = await validationService?.runTests?.({ testFile: action.testFile }) || { ok: false, error: 'Validation service unavailable.' };
                    break;
                }
                case 'fetch-webpage': {
                    try {
                        const url = String(action.url || '').trim();
                        const timeoutMs = Math.min(30000, Number(action.timeoutMs || 15000));
                        const controller = new AbortController();
                        const timer = setTimeout(() => controller.abort(), timeoutMs);
                        const response = await fetch(url, { signal: controller.signal });
                        clearTimeout(timer);
                        const text = await response.text();
                        const title = text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
                        const content = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                        result = { ok: true, path: 'web', webResult: { title, url, text: content.slice(0, 8000), length: content.length, truncated: content.length > 8000 } };
                    } catch (error) {
                        result = { ok: false, error: String(error?.message || 'Fetch failed.') };
                    }
                    break;
                }
                default:
                    result = { ok: false, error: `Unknown action type: ${action.type}.` };
            }

            // Auto-trigger validation after modifying actions (fire-and-forget)
            if (result?.ok && ['write-file', 'patch-file', 'patch-search-replace', 'patch_search_replace', 'patch-unified-diff', 'patch_unified_diff', 'delete-file'].includes(action.type)) {
                if (validationService?.trigger) {
                    validationService.trigger();
                }
            }

            return result;
        } catch (error) {
            const msg = String(error?.message || 'Action failed.');

            // Retry: search for the correct file by name
            if (['read-file', 'patch-file'].includes(action.type) && (msg.includes('ENOENT') || msg.includes('NOT_A_FILE'))) {
                const searchName = (normalizedPath || action.path || '').split(/[/\\]/).pop() || '';
                if (searchName) {
                    let suggestions = [];
                    try { suggestions = await workspaceIndex.findFileByName(searchName); } catch { /* */ }
                    if (suggestions.length > 0) {
                        emit('ai:stream-chunk', { traceId, text: `\n[Retrying ${action.type} with: ${suggestions[0]}]\n` });
                        return executeAction({ action: { ...action, path: suggestions[0] }, traceId });
                    }
                }
            }

            return { ok: false, error: msg };
        }
    };

    // ── AI SDK Integration ─────────────────────────────────────────────

    const aiSdk = createAiSdkService();
    const requestApproval = async (actionId, traceId) => {
        return new Promise((resolve) => {
            const key = `${traceId}:${actionId}`;
            pendingApprovals.set(key, (decision) => resolve(decision?.approved !== false));
            setTimeout(() => {
                if (pendingApprovals.has(key)) {
                    pendingApprovals.delete(key);
                    resolve(false);
                }
            }, 300000);
        });
    };
    const onPending = ({ traceId, action }) => {
        emit('ai:action-pending', { traceId, action });
    };

    // ── Main Entry ──────────────────────────────────────────────────────

    const sendPrompt = async ({ traceId, prompt, history, settings, workspaceRoot }) => {
        if (!traceId || !prompt) {
            emit('ai:error', { traceId, error: 'Missing required parameters.', recoverable: false });
            return;
        }

        activeSessions.set(traceId, { status: 'running' });
        const runSpan = orchestratorTracer.startSpan('agent.run', {
            attributes: {
                'pal.trace_id': traceId,
                'pal.workspace_root': String(workspaceRoot || ''),
            },
        });
        try {
            logger.info({ traceId }, 'Agent run started');
            const engine = 'lm-studio';
            if (!settings?.lmStudio?.activeModel) throw new Error('LM Studio is selected but no model is configured.');

            const [workspaceContext, { hasContext: refHas, contextText: refText }, metadataSummary, codeSummary] = await Promise.all([
                buildWorkspaceContext(workspaceRoot),
                buildReferencedFileContext(prompt),
                projectMetadataService?.getContextSummary?.() || Promise.resolve(''),
                codeSearchService?.getContextSummary?.() || Promise.resolve(''),
            ]);

            let effectivePrompt = prompt;
            if (metadataSummary) effectivePrompt = `${effectivePrompt}\n\n${metadataSummary}`;
            if (codeSummary) effectivePrompt = `${effectivePrompt}\n\n${codeSummary}`;
            if (workspaceContext) effectivePrompt = `${effectivePrompt}\n\n${workspaceContext}`;
            if (refText) effectivePrompt = `${effectivePrompt}\n\nReferenced file snapshots:\n${refText}`;

            const directive = refHas ? '\n\nReferenced file snapshots are already included in the user message context. Treat them as real workspace content and answer from them directly. Do not claim you cannot read files when snapshots are present.' : '';
            const systemPrompt = `${SYSTEM_PROMPT}\n\n${WORKSPACE_TOOLING_PROMPT}${directive}`;

            // ── AI SDK path ──────────────────────────────────────────────
            await workspaceIndex.ensureFresh();
            const tools = aiSdk.buildSdkTools({
                traceId,
                executeAction: ({ action: act, traceId: tid }) => executeAction({ action: act, traceId: tid }),
                requestApproval: (actionId, tid) => requestApproval(actionId, tid),
                onPending: ({ traceId: tid, action }) => onPending({ traceId: tid, action }),
                onToolExecution: (event) => {
                    logger.info({ traceId, ...event }, 'Tool execution event');
                    void taskMemory.recordToolExecution(event);
                },
            });
            const estimateTokens = (str) => Math.ceil(String(str || '').length / 4);
            let historyMessages = Array.isArray(history) ? history.slice(-CHAT_HISTORY_WINDOW) : [];
            const overhead = estimateTokens(systemPrompt) + estimateTokens(effectivePrompt) + 2000;
            if (overhead < MAX_CONTEXT_TOKENS) {
                const historyBudget = MAX_CONTEXT_TOKENS - overhead;
                let historyTokens = historyMessages.reduce((s, m) => s + estimateTokens(m.content), 0);
                while (historyMessages.length > 1 && historyTokens > historyBudget) {
                    const removed = historyMessages.shift();
                    historyTokens -= estimateTokens(removed.content);
                }
            }
            const messages = [...historyMessages, { role: 'user', content: effectivePrompt }];
            const editIntent = /\b(implement|fix|add|create|update|modify|refactor|rename|remove|delete|move|change|wire|integrate|build|make)\b/i.test(prompt);
            const editToolNames = new Set([
                'workspace_write_file',
                'workspace_patch_file',
                'workspace_delete_file',
                'workspace_create_folder',
                'patch_search_replace',
                'patch_unified_diff',
                'patch_rollback',
            ]);
            const editFallbackTypes = new Set([
                'write-file',
                'patch-file',
                'delete-file',
                'create-folder',
                'patch-search-replace',
                'patch-unified-diff',
                'patch-rollback',
                'patch_search_replace',
                'patch_unified_diff',
                'patch_rollback',
            ]);

            const hasEditToolCalls = (toolCalls = []) =>
                toolCalls.some((call) => editToolNames.has(String(call?.toolName || '').trim()));

            const hasEditFallbackActions = (actions = []) =>
                actions.some((action) => editFallbackTypes.has(String(action?.type || '').trim()));

            let sdkResult = await aiSdk.sendPrompt({
                traceId, systemPrompt, messages, settings,
                tools, emit, maxSteps: 6, maxTokens: 8192,
                toolChoice: 'auto',
            });

            if (!sdkResult) return; // error already emitted

            let combinedText = String(sdkResult.text || '');
            let combinedToolCalls = Array.isArray(sdkResult.toolCalls) ? [...sdkResult.toolCalls] : [];

            let fallbackActionsPreview = parseWorkspaceActionBlocks(combinedText, traceId);

            // Cline-like behavior: for implementation asks, keep going until at least one edit tool is used.
            if (editIntent && !hasEditToolCalls(combinedToolCalls) && !hasEditFallbackActions(fallbackActionsPreview)) {
                emit('ai:stream-chunk', {
                    traceId,
                    text: '\n[Agent continuation: no edit tool was used yet; proceeding to implement changes now.]\n',
                });

                const continuationMessages = [
                    ...messages,
                    { role: 'assistant', content: combinedText || 'I reviewed the request.' },
                    {
                        role: 'user',
                        content:
                            'Continue autonomously and implement the requested changes now. Do not stop at analysis. Use edit tools (patch/write/delete/create-folder) to make code changes and then summarize what was changed.',
                    },
                ];

                const followUpResult = await aiSdk.sendPrompt({
                    traceId,
                    systemPrompt,
                    messages: continuationMessages,
                    settings,
                    tools,
                    emit,
                    maxSteps: 6,
                    toolChoice: 'required',
                });

                if (followUpResult) {
                    combinedText = [combinedText, String(followUpResult.text || '')].filter(Boolean).join('\n\n');
                    combinedToolCalls = combinedToolCalls.concat(Array.isArray(followUpResult.toolCalls) ? followUpResult.toolCalls : []);
                    fallbackActionsPreview = parseWorkspaceActionBlocks(combinedText, traceId);
                }
            }

            // Final hard pass: keep full toolset available, but require an implementation attempt.
            // Restricting to edit-only tools can dead-end if the model needs one final read before patching.
            if (editIntent && !hasEditToolCalls(combinedToolCalls) && !hasEditFallbackActions(fallbackActionsPreview)) {
                emit('ai:stream-chunk', {
                    traceId,
                    text: '\n[Agent escalation: forcing implementation pass; at least one edit tool call is required before completion.]\n',
                });

                const forcedMessages = [
                    ...messages,
                    { role: 'assistant', content: combinedText || 'I gathered context.' },
                    {
                        role: 'user',
                        content:
                            'You must now perform the code change. Prefer patch/write on files you already inspected. Only read again if absolutely necessary. Before completing, execute at least one edit tool call (workspace_patch_file/workspace_write_file/workspace_delete_file/workspace_create_folder/patch_search_replace/patch_unified_diff/patch_rollback). Do not respond with analysis-only text.',
                    },
                ];

                const forcedEditResult = await aiSdk.sendPrompt({
                    traceId,
                    systemPrompt,
                    messages: forcedMessages,
                    settings,
                    tools,
                    emit,
                    maxSteps: 6,
                    toolChoice: 'required',
                });

                if (forcedEditResult) {
                    combinedText = [combinedText, String(forcedEditResult.text || '')].filter(Boolean).join('\n\n');
                    combinedToolCalls = combinedToolCalls.concat(Array.isArray(forcedEditResult.toolCalls) ? forcedEditResult.toolCalls : []);
                    fallbackActionsPreview = parseWorkspaceActionBlocks(combinedText, traceId);
                }
            }

            // Fallback: parse JSON action blocks from text (for models that don't do native tool calls)
            const fallbackActions = fallbackActionsPreview;
            const cleanedText = stripActionJsonBlocks(combinedText);

            if (fallbackActions.length > 0) {
                const autoActions = fallbackActions.filter((a) => shouldAutoApproveAction(a, 'all'));
                for (const action of autoActions) {
                    const execResult = await executeAction({ action, traceId });
                    emit('ai:action-result', { traceId, actionId: action.actionId, result: execResult });
                }

                const pendingActions = fallbackActions.filter((a) => !shouldAutoApproveAction(a, 'all'));
                if (pendingActions.length > 0) {
                    for (const action of pendingActions) {
                        emit('ai:action-pending', { traceId, action });
                        const decision = await new Promise((resolve) => {
                            const key = `${traceId}:${action.actionId}`;
                            pendingApprovals.set(key, resolve);
                            setTimeout(() => {
                                if (pendingApprovals.has(key)) {
                                    pendingApprovals.delete(key);
                                    resolve({ approved: false });
                                }
                            }, 300000);
                        });
                        if (decision.approved) {
                            const execResult = await executeAction({ action, traceId });
                            emit('ai:action-result', { traceId, actionId: action.actionId, result: execResult });
                        }
                    }
                }
            }

            if (editIntent && !hasEditToolCalls(combinedToolCalls) && !hasEditFallbackActions(fallbackActions)) {
                const traceSummary = await taskMemory.getTraceSummary(traceId);
                const guidance = [
                    cleanedText || combinedText,
                    '[Implementation not completed: no edit tool calls were executed.]',
                    'I gathered context but did not apply a code change. I should now continue with concrete edit actions (patch/write/delete/create-folder) against the discovered files.',
                    `Run summary: ${traceSummary.total} tools (${traceSummary.readCount} reads, ${traceSummary.editCount} edits, ${traceSummary.failedCount} failed).`,
                ].filter(Boolean).join('\n\n');

                emit('ai:done', {
                    traceId,
                    text: guidance,
                    actions: fallbackActions,
                    nativeActions: combinedToolCalls,
                    enforcementWarning: 'missing-edit-action',
                });
                runSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'missing-edit-action' });
                logger.warn({ traceId, nativeToolCalls: combinedToolCalls.length }, 'Agent completed without edit tool usage');
                return;
            }

            emit('ai:done', {
                traceId,
                text: cleanedText || combinedText,
                actions: fallbackActions,
                nativeActions: combinedToolCalls,
            });
            runSpan.setStatus({ code: SpanStatusCode.OK });
            logger.info({ traceId, nativeToolCalls: combinedToolCalls.length }, 'Agent run completed');
        } catch (error) {
            runSpan.recordException(error);
            runSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(error?.message || 'AI request failed.') });
            logger.error({ traceId, error: String(error?.message || error) }, 'Agent run failed');
            emit('ai:error', {
                traceId,
                error: String(error?.message || 'AI request failed.'),
                recoverable: false,
            });
        } finally {
            runSpan.end();
            activeSessions.delete(traceId);
        }
    };

    const respondToAction = ({ traceId, actionId, approved }) => {
        const key = `${traceId}:${actionId}`;
        const resolver = pendingApprovals.get(key);
        if (resolver) { resolver({ approved: Boolean(approved) }); pendingApprovals.delete(key); }
    };

    const cancelSession = ({ traceId }) => {
        for (const [key, resolver] of pendingApprovals) {
            if (key.startsWith(`${traceId}:`)) { resolver({ approved: false }); pendingApprovals.delete(key); }
        }
        activeSessions.delete(traceId);
    };

    return { sendPrompt, respondToAction, cancelSession };
};
