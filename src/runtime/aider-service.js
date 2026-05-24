import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const TOKENS_LINE_RE = /^Tokens:\s+\d+\s+sent,\s+\d+\s+received\.?$/;
const HEADER_END_RE = /^\s*-{3,}\s*$/;
const AIDER_PROMPT_RE = /^>\s*$/;
const DEFAULT_AIDER_TIMEOUT_MS = 45000;
const MAX_STREAM_CHARS = 16000;
const SEARCH_REPLACE_BLOCK_RE = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
const FILE_PATH_HINT_RE = /`?([A-Za-z0-9._/-]+\.[A-Za-z0-9._-]+)`?$/;
const MAX_HISTORY_ITEMS = 3;
const MAX_HISTORY_CHARS_PER_MESSAGE = 500;
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg', '.pdf',
    '.zip', '.tar', '.gz', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib',
]);

const stripAnsi = (text) => text.replace(ANSI_RE, '');

const isBinaryExtension = (filePath) => BINARY_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());

const isBinaryContent = (filePath) => {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(2048);
        const bytesRead = fs.readSync(fd, buffer, 0, 2048, 0);
        fs.closeSync(fd);
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) {
                return true;
            }
        }
        return false;
    } catch {
        return true;
    }
};

const spawnAider = (args, options = {}) => {
    if (process.platform === 'win32') {
        const comspec = process.env.ComSpec || 'cmd.exe';
        return spawn(comspec, ['/d', '/s', '/c', 'aider', ...args], {
            ...options,
            shell: false,
        });
    }

    return spawn('aider', args, {
        ...options,
        shell: false,
    });
};

const collectWorkspaceSummary = (root) => {
    try {
        const dirEntries = fs.readdirSync(root, { withFileTypes: true });
        let directories = 0;
        let files = 0;
        for (const entry of dirEntries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                continue;
            }

            if (entry.isDirectory()) {
                directories += 1;
            } else {
                files += 1;
            }
        }

        return `Workspace ready. Top-level items: ${directories} directories, ${files} files.`;
    } catch {
        return 'Workspace ready.';
    }
};

const findWorkspaceEntryByName = (root, targetName) => {
    const needle = String(targetName || '').trim().toLowerCase();
    if (!needle) {
        return null;
    }

    const walk = (dir, depth) => {
        if (depth > 4) {
            return null;
        }

        let dirEntries;
        try {
            dirEntries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return null;
        }

        for (const entry of dirEntries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                continue;
            }

            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
            if (entry.name.toLowerCase() === needle || relativePath.toLowerCase() === needle.replace(/\\/g, '/')) {
                return {
                    exists: true,
                    isDirectory: entry.isDirectory(),
                    relativePath,
                };
            }

            if (entry.isDirectory()) {
                const nested = walk(fullPath, depth + 1);
                if (nested) {
                    return nested;
                }
            }
        }

        return null;
    };

    return walk(root, 0);
};

const compactHistory = (history) => {
    if (!Array.isArray(history) || history.length === 0) {
        return '';
    }

    const slice = history
        .slice(-MAX_HISTORY_ITEMS)
        .map((item) => {
            const role = String(item?.role || 'user');
            const content = String(item?.content || '')
                .replace(/```[\s\S]*?```/g, '[code omitted]')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, MAX_HISTORY_CHARS_PER_MESSAGE);
            return `${role}: ${content}`;
        })
        .filter(Boolean);

    return slice.join('\n\n');
};

const LOCATION_QUERY_STOP_WORDS = new Set([
    'the', 'a', 'an', 'to', 'in', 'on', 'at', 'for', 'of', 'and', 'or', 'is', 'are', 'be', 'we', 'our',
    'where', 'find', 'locate', 'search', 'which', 'what', 'file', 'files', 'registered', 'register',
    'mounted', 'rendered', 'wired', 'show', 'me', 'you', 'have', 'with', 'from', 'this', 'that',
    'how', 'about', 'can', 'could', 'please', 'app', 'it', 'defined', 'define',
]);

const normalizeSearchTerms = (promptText) => {
    const text = String(promptText || '').trim();
    if (!text) {
        return [];
    }

    const terms = new Set();
    const add = (value) => {
        const term = String(value || '').trim().toLowerCase();
        if (!term || term.length < 3) {
            return;
        }

        if (LOCATION_QUERY_STOP_WORDS.has(term)) {
            return;
        }

        terms.add(term);
    };

    const quoted = text.match(/"([^"]+)"|'([^']+)'/g) || [];
    for (const item of quoted) {
        add(item.replace(/^['"]|['"]$/g, ''));
    }

    const rawTokens = text
        .replace(/[{}()[\],.:;!?`~<>\\/+=*|@#$%^&]+/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);

    for (const token of rawTokens) {
        add(token);
        if (/^[A-Z][A-Za-z0-9_]*$/.test(token)) {
            add(token.toLowerCase());
        }
    }

    // Add adjacent token phrases like "chat panel" or "title bar" for better matching.
    for (let i = 0; i < rawTokens.length - 1; i++) {
        const first = rawTokens[i].toLowerCase();
        const second = rawTokens[i + 1].toLowerCase();
        if (!LOCATION_QUERY_STOP_WORDS.has(first) && !LOCATION_QUERY_STOP_WORDS.has(second)) {
            add(`${first} ${second}`);
        }
    }

    return [...terms].slice(0, 12);
};

const scoreTextByTerms = (text, terms) => {
    const lower = String(text || '').toLowerCase();
    let score = 0;
    for (const term of terms) {
        if (!term) continue;
        const compact = term.replace(/\s+/g, '');
        if (lower === term || lower === compact) {
            score += 8;
            continue;
        }
        if (lower.includes(term) || lower.includes(compact)) {
            score += 3;
        }
    }
    return score;
};

const findFirstMatchingLine = (absPath, terms) => {
    let content = '';
    try {
        content = fs.readFileSync(absPath, 'utf-8');
    } catch {
        return { line: 0, snippet: '' };
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lower = line.toLowerCase();
        if (terms.some((term) => lower.includes(term) || lower.includes(term.replace(/\s+/g, '')))) {
            return {
                line: i + 1,
                snippet: line.trim().slice(0, 180),
            };
        }
    }

    return { line: 0, snippet: '' };
};

const buildLocationSearchPaths = async ({ workspaceIndex, codeSearchService, workspaceRoot, prompt }) => {
    const terms = normalizeSearchTerms(prompt);
    if (!terms.length) {
        return [];
    }

    const matches = [];

    if (codeSearchService?.search) {
        const queries = [String(prompt || '').trim(), ...terms.filter((term) => term.length >= 4).slice(0, 4)]
            .filter(Boolean);
        const seenQueries = new Set();

        for (const query of queries) {
            if (seenQueries.has(query)) {
                continue;
            }
            seenQueries.add(query);

            let declarations = [];
            try {
                declarations = await codeSearchService.search(query);
            } catch {
                declarations = [];
            }

            for (const item of declarations) {
                const itemPath = String(item?.relativePath || '').trim();
                if (!itemPath) {
                    continue;
                }

                const pathScore = scoreTextByTerms(itemPath, terms);
                const nameScore = scoreTextByTerms(item?.name || '', terms);
                const detailScore = scoreTextByTerms(item?.detail || '', terms);
                const typeScore = String(item?.type || '').includes('export') ? 1 : 0;
                const score = pathScore + nameScore + detailScore + typeScore;

                if (score <= 0) {
                    continue;
                }

                matches.push({
                    path: itemPath,
                    line: Number(item?.line || 0),
                    snippet: `${String(item?.type || 'decl')} ${String(item?.name || '').trim()}`.trim(),
                    score,
                });
            }
        }
    }

    const allPaths = workspaceIndex?.getAllPaths
        ? (await workspaceIndex.getAllPaths()) || []
        : [];

    const candidates = [];
    for (const relPath of allPaths) {
        const lower = String(relPath || '').toLowerCase();
        const fileName = lower.split('/').pop() || lower;
        const score = scoreTextByTerms(fileName, terms) + scoreTextByTerms(lower, terms);

        if (score > 0) {
            candidates.push({ path: relPath, score });
        }
    }

    if (candidates.length) {
        const topPathCandidates = candidates
            .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
            .slice(0, 12)
            .map((item) => item.path);

        for (const relPath of topPathCandidates) {
            const absPath = path.resolve(workspaceRoot, relPath);
            const { line, snippet } = findFirstMatchingLine(absPath, terms);
            matches.push({
                path: relPath,
                line,
                snippet,
                score: 10 + scoreTextByTerms(relPath, terms),
            });
        }
    }

    const looseMatches = [];
    for (const relPath of allPaths) {
        if (looseMatches.length >= 12) {
            break;
        }

        const absPath = path.resolve(workspaceRoot, relPath);
        let stat;
        try {
            stat = fs.statSync(absPath);
        } catch {
            continue;
        }

        if (!stat.isFile() || isBinaryExtension(absPath) || isBinaryContent(absPath)) {
            continue;
        }

        let content = '';
        try {
            content = fs.readFileSync(absPath, 'utf-8');
        } catch {
            continue;
        }

        const lowerContent = content.toLowerCase();
        if (terms.some((term) => lowerContent.includes(term.toLowerCase()))) {
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (terms.some((term) => line.toLowerCase().includes(term.toLowerCase()))) {
                    looseMatches.push({
                        path: relPath,
                        line: i + 1,
                        snippet: line.trim().slice(0, 180),
                    });
                    break;
                }
            }
        }
    }

    for (const item of looseMatches) {
        matches.push({
            ...item,
            score: 2 + scoreTextByTerms(item.path, terms),
        });
    }

    const deduped = new Map();
    for (const item of matches) {
        const key = `${item.path}:${item.line || 0}`;
        const existing = deduped.get(key);
        if (!existing || item.score > existing.score) {
            deduped.set(key, item);
        }
    }

    return [...deduped.values()]
        .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
        .slice(0, 8);
};

const sanitizeFileStem = (value, fallback = 'script') => {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/https?:\/\//g, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return normalized || fallback;
};

const extractDiffActions = (text) => {
    const lines = String(text || '').split(/\r?\n/);
    const offsetToLine = [];
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
        offsetToLine.push(cursor);
        cursor += lines[i].length + 1;
    }

    const resolveNearestPath = (blockOffset) => {
        let lineIndex = 0;
        for (let i = 0; i < offsetToLine.length; i++) {
            if (offsetToLine[i] <= blockOffset) {
                lineIndex = i;
            } else {
                break;
            }
        }

        for (let i = lineIndex; i >= 0; i--) {
            const candidate = String(lines[i] || '').trim();
            if (!candidate) continue;
            const normalized = candidate
                .replace(/^[-*]\s+/, '')
                .replace(/^(?:File|Editing|Modified|Update|Updated|Applying patch to)\s*:?\s*/i, '')
                .replace(/[),.;:]+$/, '');
            const match = normalized.match(FILE_PATH_HINT_RE);
            if (match?.[1]) {
                return match[1];
            }
        }

        return 'unknown';
    };

    const byPath = new Map();
    const matcher = new RegExp(SEARCH_REPLACE_BLOCK_RE.source, 'g');
    let match;
    while ((match = matcher.exec(text)) !== null) {
        const path = resolveNearestPath(match.index);
        const entry = byPath.get(path) || {
            type: 'patch-search-replace',
            path,
            summary: `AI suggested edit in ${path}`,
            patches: [],
        };
        entry.patches.push({ find: match[1].trimEnd(), replace: match[2].trimEnd() });
        byPath.set(path, entry);
    }

    return Array.from(byPath.values());
};

export const createAiderService = ({ getWorkspaceRoot, getMainWindow, workspaceIndex, codeSearchService }) => {
    const logger = console;
    const activeProcesses = new Map();

    const emit = (channel, payload) => {
        const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    };

    const checkAvailable = async () => {
        return new Promise((resolve) => {
            let child;
            try {
                child = spawnAider(['--version'], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
            } catch (err) {
                resolve({ available: false, version: null, error: String(err?.message || err) });
                return;
            }
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d) => { stdout += String(d); });
            child.stderr.on('data', (d) => { stderr += String(d); });
            child.on('close', (code) => {
                if (code === 0 && stdout.trim()) {
                    resolve({ available: true, version: stdout.trim() });
                } else {
                    resolve({ available: false, version: null, error: stderr.trim() || `exit code ${code}` });
                }
            });
            child.on('error', (err) => resolve({ available: false, version: null, error: err?.message }));
        });
    };

    const buildArgs = ({ modelName, apiBase, settings, root }) => {
        const aider = settings?.aider || {};
        const requestedMapTokens = Number(aider.mapTokens);
        const mapTokens = Number.isFinite(requestedMapTokens) ? requestedMapTokens : 128;
        const args = [
            '--no-suggest-shell-commands',
            '--no-pretty',
            '--no-show-model-warnings',
            '--no-check-update',
            '--model', `openai/${modelName}`,
            '--openai-api-base', apiBase,
        ];
        if (!aider.autoCommits) args.push('--no-auto-commits');
        args.push('--no-git');
        if (aider.autoLint) args.push('--lint');
        args.push('--map-tokens', String(Math.max(0, Math.min(256, mapTokens))));
        return args;
    };

    const abortSession = (traceId) => {
        const proc = activeProcesses.get(traceId);
        if (proc) {
            try { proc.kill('SIGTERM'); } catch { /* */ }
            setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch { /* */ }
            }, 2000);
            activeProcesses.delete(traceId);
        }
    };

    const sendMessage = async ({ traceId, prompt, history, settings, workspaceRoot }) => {
        const modelName = settings?.lmStudio?.activeModel;
        if (!modelName) {
            emit('ai:error', { traceId, error: 'No model configured for Aider.', recoverable: false });
            return;
        }

        const apiBase = (settings?.lmStudio?.endpointUrl || 'http://localhost:1234') + '/v1';
        const root = workspaceRoot || (typeof getWorkspaceRoot === 'function' ? getWorkspaceRoot() : null) || process.cwd();

        const workspaceSummary = collectWorkspaceSummary(root);
        const historyText = compactHistory(history);
        const requestedNameMatch = String(prompt || '').match(/file\s+named\s+["']?([^"'\n]+)["']?/i);
        const requestedName = String(requestedNameMatch?.[1] || '').trim();
        const matchedEntry = requestedName ? findWorkspaceEntryByName(root, requestedName) : null;
        const promptText = String(prompt || '');
        const askedForPowershellScript = /powershell/i.test(promptText) && /script/i.test(promptText);
        const askedForHelloWorldScript = askedForPowershellScript && /hello\s*world/i.test(promptText);
        const askedForPingScript = askedForPowershellScript && /\bping(s|ing)?\b/i.test(promptText);
        const domainMatch = promptText.match(/\b(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
        const targetDomain = String(domainMatch?.[1] || '').trim().toLowerCase();

        const looksLikeLocationQuestion = /\b(where|locate|find|search|which file|what file|registered|registered in|registered at|mounted|rendered|wired)\b/i.test(promptText)
            || /\b(custom title bar|title bar|titlebar)\b/i.test(promptText);

        if (looksLikeLocationQuestion) {
            const matches = await buildLocationSearchPaths({
                workspaceIndex,
                codeSearchService,
                workspaceRoot: root,
                prompt: promptText,
            });
            if (matches.length > 0) {
                const text = matches
                    .map((match) => (
                        `Found likely location: ${match.path}${match.line ? `:${match.line}` : ''}${match.snippet ? ` - ${match.snippet}` : ''}`
                    ))
                    .slice(0, 5)
                    .join('\n');
                emit('ai:done', { traceId, text, actions: [], nativeActions: [] });
                return { text, actions: [], nativeActions: [] };
            }
        }

        if (requestedName && askedForHelloWorldScript) {
            const folderPath = matchedEntry?.exists && matchedEntry?.isDirectory
                ? matchedEntry.relativePath
                : requestedName.replace(/\\/g, '/').replace(/\/+$/, '');

            const actions = [];
            if (!matchedEntry?.exists) {
                actions.push({
                    type: 'create-folder',
                    path: folderPath,
                    summary: `Create folder ${folderPath}`,
                });
            }

            const scriptPath = `${folderPath}/hello-world-terminal.ps1`;
            const scriptContent = [
                '# Opens a new PowerShell window and prints Hello world',
                `Start-Process powershell -ArgumentList '-NoExit','-Command','Write-Host "Hello world"'`,
            ].join('\n');

            actions.push({
                type: 'write-file',
                path: scriptPath,
                content: `${scriptContent}\n`,
                summary: 'Create test PowerShell script',
            });

            const existenceText = matchedEntry?.exists
                ? `Yes, I can see ${requestedName} (${matchedEntry.isDirectory ? 'folder' : 'file'}).`
                : `I did not find ${requestedName}, so I will create it as a folder.`;

            const text = `${existenceText}\n\nI prepared a test PowerShell script at ${scriptPath}. Approve Apply to create it.`;
            emit('ai:done', { traceId, text, actions, nativeActions: actions });
            return { text, actions, nativeActions: actions };
        }

        if (askedForPingScript && targetDomain) {
            const experimentsEntry = findWorkspaceEntryByName(root, 'experiments');
            const targetFolder = experimentsEntry?.exists && experimentsEntry?.isDirectory
                ? experimentsEntry.relativePath
                : 'experiments';
            const fileStem = sanitizeFileStem(`ping-${targetDomain.replace(/\./g, '-')}`, 'ping-website');
            const scriptPath = `${targetFolder}/${fileStem}.ps1`;
            const scriptContent = [
                `# Ping ${targetDomain} and show a short result`,
                `$target = "${targetDomain}"`,
                'Write-Host "Pinging $target..." -ForegroundColor Cyan',
                'ping $target',
            ].join('\n');

            const actions = [];
            if (!experimentsEntry?.exists) {
                actions.push({
                    type: 'create-folder',
                    path: targetFolder,
                    summary: `Create folder ${targetFolder}`,
                });
            }

            actions.push({
                type: 'write-file',
                path: scriptPath,
                content: `${scriptContent}\n`,
                summary: `Create PowerShell ping script for ${targetDomain}`,
            });

            const text = `Prepared a PowerShell ping script for ${targetDomain} at ${scriptPath}.`;
            emit('ai:done', { traceId, text, actions, nativeActions: actions });
            return { text, actions, nativeActions: actions };
        }

        if (requestedName && !askedForPowershellScript && /do\s+you\s+see/i.test(String(prompt || ''))) {
            const text = matchedEntry?.exists
                ? `Yes, I can see ${requestedName} (${matchedEntry.isDirectory ? 'folder' : 'file'}) at ${matchedEntry.relativePath}.`
                : `No, I do not see ${requestedName} in the workspace snapshot.`;
            emit('ai:done', { traceId, text, actions: [], nativeActions: [] });
            return { text, actions: [], nativeActions: [] };
        }

        const behaviorInstructions = [
            'You are PAL agent running inside a local IDE.',
            'Follow the latest user request exactly and do not switch to generic repository analysis unless explicitly asked.',
            'If asked whether a file/folder exists, answer directly from the workspace snapshot.',
            'For requested code or script changes, provide concrete edits using SEARCH/REPLACE blocks and include the target path.',
            'Never ask to add files to chat; work only from the provided prompt context.',
            'Keep the response concise and task-focused.',
        ].join('\n');

        const fullPrompt = [
            `System behavior:\n${behaviorInstructions}`,
            workspaceSummary,
            requestedName ? `Requested entry lookup: ${requestedName} => ${matchedEntry?.exists ? `${matchedEntry.isDirectory ? 'directory' : 'file'} at ${matchedEntry.relativePath}` : 'not found'}` : '',
            historyText ? `Previous conversation:\n${historyText}` : '',
            `Current user request:\n${prompt}`,
        ].filter(Boolean).join('\n\n');

        const env = { ...process.env };
        env.OPENAI_API_KEY = env.OPENAI_API_KEY || 'not-needed';
        env.AIDER_OPENAI_API_BASE = apiBase;

        const args = buildArgs({ modelName, apiBase, settings, root });
        const tmpFile = path.join(root, `.aider-msg-${traceId || Date.now()}.md`);
        fs.writeFileSync(tmpFile, fullPrompt, 'utf-8');
        args.push('--message-file', tmpFile);

        let child;
        try {
            child = spawnAider(args, {
                cwd: root,
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
            });
        } catch (err) {
            try { fs.unlinkSync(tmpFile); } catch { /* */ }
            const error = String(err?.message || 'Failed to start Aider process.');
            emit('ai:error', { traceId, error, recoverable: true });
            return { text: '', error };
        }

        activeProcesses.set(traceId, child);

        let stdout = '';
        let stderr = '';
        let streamedChars = 0;
        let streamOverflowed = false;
        let headerDone = false;
        let headerProbeCount = 0;
        let stdoutLineBuffer = '';
        let settled = false;
        let timeoutId = null;
        const timeoutMs = Math.max(10000, Number(settings?.aider?.requestTimeoutMs || DEFAULT_AIDER_TIMEOUT_MS));

        const clearRequestTimeout = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        const armRequestTimeout = () => {
            clearRequestTimeout();
            timeoutId = setTimeout(() => {
                if (settled) {
                    return;
                }

                settled = true;
                const timeoutError = `Aider timed out after ${Math.round(timeoutMs / 1000)}s without completing.`;
                try { child.kill('SIGTERM'); } catch { /* */ }
                setTimeout(() => {
                    try { child.kill('SIGKILL'); } catch { /* */ }
                }, 1500);
                activeProcesses.delete(traceId);
                try { fs.unlinkSync(tmpFile); } catch { /* */ }
                emit('ai:error', { traceId, error: timeoutError, recoverable: true });
            }, timeoutMs);
        };

        armRequestTimeout();

        const handleStdoutLine = (line) => {
            const trimmed = line.trim();
            if (!headerDone) {
                if (HEADER_END_RE.test(trimmed)) {
                    headerDone = true;
                    return;
                }

                if (trimmed) {
                    headerProbeCount += 1;
                    if (headerProbeCount > 24) {
                        headerDone = true;
                    }
                }

                if (!headerDone) {
                    return;
                }
            }

            if (!trimmed || TOKENS_LINE_RE.test(trimmed) || AIDER_PROMPT_RE.test(trimmed)) {
                return;
            }

            if (streamOverflowed) {
                return;
            }

            streamedChars += line.length;
            if (streamedChars > MAX_STREAM_CHARS) {
                streamOverflowed = true;
                emit('ai:stream-chunk', {
                    traceId,
                    text: '\n[Output truncated to keep the response concise.]\n',
                });
                return;
            }

            emit('ai:stream-chunk', { traceId, text: `${line}\n` });
        };

        child.stdout.on('data', (data) => {
            armRequestTimeout();
            const text = String(data);
            stdout += text;
            stdoutLineBuffer += stripAnsi(text);
            const parts = stdoutLineBuffer.split(/\r?\n/);
            stdoutLineBuffer = parts.pop() || '';

            for (const line of parts) {
                handleStdoutLine(line);
            }
        });

        child.stderr.on('data', (data) => {
            armRequestTimeout();
            stderr += String(data);
        });

        return new Promise((resolve) => {
            child.on('close', (code) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearRequestTimeout();
                activeProcesses.delete(traceId);
                try { fs.unlinkSync(tmpFile); } catch { /* */ }

                if (stdoutLineBuffer) {
                    handleStdoutLine(stdoutLineBuffer);
                    stdoutLineBuffer = '';
                }

                const cleanStdout = stripAnsi(stdout);
                const body = extractResponseBody(cleanStdout);
                const diffActions = extractDiffActions(cleanStdout);
                const truncatedBody = streamOverflowed
                    ? `${body || ''}\n\n[Output was truncated to keep the response concise.]`.trim()
                    : body;

                if (code === 0 && truncatedBody) {
                    if (diffActions.length > 0) {
                        emit('ai:done', { traceId, text: truncatedBody, actions: diffActions, nativeActions: diffActions });
                        resolve({ text: truncatedBody, actions: diffActions, nativeActions: diffActions });
                    } else {
                        emit('ai:done', { traceId, text: truncatedBody, actions: [], nativeActions: [] });
                        resolve({ text: truncatedBody, actions: [], nativeActions: [] });
                    }
                } else {
                    const error = stderr.trim() || 'Aider exited with code ' + code;
                    if (!truncatedBody) {
                        emit('ai:error', { traceId, error, recoverable: false });
                        resolve({ text: '', error });
                    } else {
                        emit('ai:done', { traceId, text: truncatedBody, actions: diffActions, nativeActions: diffActions });
                        resolve({ text: truncatedBody, actions: diffActions, nativeActions: diffActions });
                    }
                }
            });

            child.on('error', (err) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearRequestTimeout();
                activeProcesses.delete(traceId);
                try { fs.unlinkSync(tmpFile); } catch { /* */ }
                const error = String(err?.message || 'Failed to start Aider.');
                emit('ai:error', { traceId, error, recoverable: true });
                resolve({ text: '', error });
            });
        });
    };

    const extractResponseBody = (text) => {
        const lines = text.split('\n');
        let inBody = false;
        const body = [];
        for (const line of lines) {
            if (!inBody) {
                if (HEADER_END_RE.test(line.trim())) {
                    inBody = true;
                }
                continue;
            }
            const trimmed = line.trim();
            if (TOKENS_LINE_RE.test(trimmed) || AIDER_PROMPT_RE.test(trimmed)) {
                continue;
            }
            body.push(line);
        }
        return body.join('\n').trim();
    };

    const getActiveSessions = () => Array.from(activeProcesses.keys());

    return { checkAvailable, sendMessage, abortSession, getActiveSessions };
};