import fs from 'node:fs';
import path from 'node:path';

const IGNORED_NAMES = new Set(['.git', 'node_modules', '.vite', 'dist', 'out', '.next', '.cache', '__pycache__', '.venv', '.svn']);
const INDEXED_EXTENSIONS = new Set([
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
    '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.css', '.scss', '.less', '.sass',
    '.html', '.htm', '.xhtml', '.xml', '.svg',
    '.md', '.mdx', '.txt', '.csv', '.log',
    '.py', '.rb', '.php', '.java', '.go', '.rs', '.swift', '.kt', '.kts', '.cs',
    '.c', '.cpp', '.h', '.hpp',
    '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
    '.env', '.env.example', '.gitignore', '.gitattributes', '.editorconfig',
    '.lock', '.patch', '.diff',
    '.vue', '.svelte', '.astro',
    '.sql', '.graphql', '.gql',
]);

export const createWorkspaceIndex = ({ getWorkspaceRoot }) => {
    let files = new Set();
    let directories = new Set();
    let fileNameMap = new Map();
    let allPaths = [];
    let dirty = true;
    let totalNodes = 0;

    const buildIndex = async () => {
        const root = getWorkspaceRoot();
        if (!root) return;

        const nextFiles = new Set();
        const nextDirs = new Set(['']);
        const nextNameMap = new Map();
        const nextPaths = [];
        let nodes = 0;

    const walk = (dirPath, relPath) => {
        let entries;
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (IGNORED_NAMES.has(entry.name)) continue;
            if (entry.name.startsWith('.')) continue;

            let fullPath;
            try {
                fullPath = path.join(dirPath, entry.name);
            } catch {
                continue;
            }

            const relative = relPath ? `${relPath}/${entry.name}` : entry.name;

            let isDir = false;
            let isFile = false;
            try {
                isDir = entry.isDirectory();
                isFile = entry.isFile();
            } catch {
                continue;
            }

            if (isDir) {
                nextDirs.add(relative.toLowerCase());
                walk(fullPath, relative);
            } else if (isFile) {
                const lower = relative.toLowerCase();
                let ext;
                try {
                    ext = path.extname(entry.name).toLowerCase();
                } catch {
                    continue;
                }

                if (!INDEXED_EXTENSIONS.has(ext)) continue;

                nextFiles.add(lower);
                nextPaths.push(relative);

                const baseName = entry.name.toLowerCase();
                const existing = nextNameMap.get(baseName);
                if (existing) {
                    existing.push(relative);
                } else {
                    nextNameMap.set(baseName, [relative]);
                }

                nodes++;
            }
        }
    };

        walk(root, '');
        totalNodes = nodes;

        files = nextFiles;
        directories = nextDirs;
        fileNameMap = nextNameMap;
        allPaths = nextPaths;
        dirty = false;
    };

    const ensureFresh = async () => {
        if (dirty) {
            await buildIndex();
        }
    };

    const markDirty = () => {
        dirty = true;
    };

    const getAllPaths = async () => {
        await ensureFresh();
        return [...allPaths];
    };

    const getAllFiles = async () => {
        await ensureFresh();
        return [...files];
    };

    const getAllDirectories = async () => {
        await ensureFresh();
        return [...directories];
    };

    const isKnownPath = async (relativePath) => {
        await ensureFresh();
        const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase().replace(/^\/+|\/+$/g, '');
        if (!normalized) return false;
        return files.has(normalized) || directories.has(normalized);
    };

    const findFileByName = async (name) => {
        await ensureFresh();
        const normalized = String(name || '').toLowerCase().replace(/\\/g, '/');
        if (!normalized) return [];

        const parts = normalized.split('/');
        const fileName = parts[parts.length - 1];

        const matches = fileNameMap.get(fileName);
        if (matches) return [...matches];

        if (parts.length > 1) {
            const dirPrefix = parts.slice(0, -1).join('/');
            return [...fileNameMap.values()]
                .flat()
                .filter((p) => p.startsWith(dirPrefix + '/') && p.endsWith('/' + fileName));
        }

        return [];
    };

    const searchPaths = async (pattern) => {
        await ensureFresh();
        const lower = String(pattern || '').toLowerCase().replace(/\\/g, '/');

        if (!lower.includes('*') && !lower.includes('?')) {
            return allPaths.filter((p) => p.toLowerCase().includes(lower)).slice(0, 200);
        }

        const regexStr = lower
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*{2,}/g, '**')
            .replace(/\*\*/g, '___GLOBSTAR___')
            .replace(/\*/g, '[^/]*')
            .replace(/___GLOBSTAR___/g, '.*')
            .replace(/\?/g, '[^/]');

        try {
            const regex = new RegExp(`^${regexStr}$`);
            return allPaths.filter((p) => regex.test(p.toLowerCase())).slice(0, 200);
        } catch {
            return allPaths.filter((p) => p.toLowerCase().includes(lower)).slice(0, 200);
        }
    };

    const getIndexStats = async () => {
        await ensureFresh();
        return {
            totalFiles: files.size,
            totalDirectories: directories.size,
            totalNodes,
            dirty: false,
        };
    };

    return {
        ensureFresh,
        buildIndex,
        markDirty,
        getAllPaths,
        getAllFiles,
        getAllDirectories,
        isKnownPath,
        findFileByName,
        searchPaths,
        getIndexStats,
    };
};
