import fs from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';
import { WORKSPACE_IGNORED_NAMES } from '../shared/workspace-constants';

const sortEntries = (entries) =>
    [...entries].sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        if (aDir !== bDir) {
            return aDir - bDir;
        }
        return a.name.localeCompare(b.name);
    });

const normalizeInsideRoot = (rootPath, targetPath) => {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);

    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('Path is outside workspace root.');
    }

    return resolvedTarget;
};

export const createProjectService = ({ getWorkspaceRoot }) => {
    const safeStat = (p) => {
        try { return fs.statSync(p); } catch { return null; }
    };

    const buildTreeNode = (absolutePath, rootPath) => {
        const stat = safeStat(absolutePath);
        if (!stat) return null;
        const relative = path.relative(rootPath, absolutePath) || '.';
        const node = {
            id: relative,
            name: path.basename(absolutePath) || path.basename(rootPath),
            path: absolutePath,
            relativePath: relative,
            isDirectory: stat.isDirectory(),
        };

        if (stat.isDirectory()) {
            try {
                const entries = fs
                    .readdirSync(absolutePath, { withFileTypes: true })
                    .filter((entry) => !WORKSPACE_IGNORED_NAMES.has(entry.name));

                node.children = sortEntries(entries).flatMap((entry) => {
                    let childPath;
                    try { childPath = path.join(absolutePath, entry.name); } catch { return []; }
                    const child = buildTreeNode(childPath, rootPath);
                    return child ? [child] : [];
                });
            } catch {
                node.children = [];
            }
        }

        return node;
    };

    const listProjectTree = () => {
        const root = getWorkspaceRoot();
        const rootNode = buildTreeNode(root, root);
        return {
            root,
            tree: rootNode.children || [],
        };
    };

    const readProjectFile = ({ path: targetPath }) => {
        if (!targetPath || typeof targetPath !== 'string') {
            throw new Error('A file path is required.');
        }

        const root = getWorkspaceRoot();
        const filePath = normalizeInsideRoot(root, targetPath);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            throw new Error('Selected path is not a file.');
        }

        return {
            path: filePath,
            content: fs.readFileSync(filePath, 'utf-8'),
        };
    };

    const parseNumstat = (raw, root) => {
        const map = {};
        if (!raw) return map;
        for (const line of raw.split('\n')) {
            const parts = line.trim().split('\t');
            if (parts.length < 3) continue;
            const [add, del, ...nameParts] = parts;
            const filePath = nameParts.join('\t');
            if (!filePath) continue;
            const absPath = path.join(root, filePath);
            const isBinary = add === '-' && del === '-';
            map[filePath] = {
                additions: isBinary ? 0 : Math.max(0, parseInt(add, 10) || 0),
                deletions: isBinary ? 0 : Math.max(0, parseInt(del, 10) || 0),
                isBinary,
            };
        }
        return map;
    };

    const countFileLines = (absolutePath) => {
        try {
            const content = fs.readFileSync(absolutePath, 'utf-8');
            if (!content) return 0;
            return content.split('\n').length;
        } catch {
            return 0;
        }
    };

    const getGitStatus = async () => {
        const root = getWorkspaceRoot();
        const git = simpleGit(root);
        const isRepo = await git.checkIsRepo();

        if (!isRepo) {
            return {
                isRepo: false,
                branch: null,
                staged: [],
                unstaged: [],
            };
        }

        const status = await git.status();
        const [stagedNumstatRaw, unstagedNumstatRaw] = await Promise.all([
            git.raw(['diff', '--cached', '--numstat']).catch(() => ''),
            git.raw(['diff', '--numstat']).catch(() => ''),
        ]);
        const stagedNumstat = parseNumstat(stagedNumstatRaw, root);
        const unstagedNumstat = parseNumstat(unstagedNumstatRaw, root);

        const staged = [];
        const unstaged = [];

        for (const file of status.files) {
            const label = file.path;
            if (file.index && file.index !== ' ') {
                const stats = stagedNumstat[label] || {};
                staged.push({
                    path: label,
                    index: file.index,
                    workingDir: file.working_dir,
                    additions: stats.additions ?? 0,
                    deletions: stats.deletions ?? 0,
                    isBinary: stats.isBinary ?? false,
                });
            }
            if (file.working_dir && file.working_dir !== ' ') {
                const isUntracked = file.working_dir === '?';
                const stats = isUntracked
                    ? { additions: countFileLines(path.join(root, label)), deletions: 0, isBinary: false }
                    : (unstagedNumstat[label] || {});
                unstaged.push({
                    path: label,
                    index: file.index,
                    workingDir: file.working_dir,
                    additions: stats.additions ?? 0,
                    deletions: stats.deletions ?? 0,
                    isBinary: stats.isBinary ?? false,
                });
            }
        }

        return {
            isRepo: true,
            branch: status.current,
            staged,
            unstaged,
        };
    };

    const commitChanges = async ({ message }) => {
        const commitMessage = String(message || '').trim();
        if (!commitMessage) {
            throw new Error('Commit message is required.');
        }

        const root = getWorkspaceRoot();
        const git = simpleGit(root);
        const isRepo = await git.checkIsRepo();

        if (!isRepo) {
            throw new Error('Current workspace is not a git repository.');
        }

        await git.add(['-A']);
        const result = await git.commit(commitMessage);

        return {
            commit: result.commit,
            summary: result.summary,
        };
    };

    const stageFile = async ({ filePath }) => {
        const target = String(filePath || '').trim();
        if (!target) {
            throw new Error('filePath is required.');
        }

        const root = getWorkspaceRoot();
        const git = simpleGit(root);
        await git.add([target]);

        return {
            staged: true,
            filePath: target,
        };
    };

    const unstageFile = async ({ filePath }) => {
        const target = String(filePath || '').trim();
        if (!target) {
            throw new Error('filePath is required.');
        }

        const root = getWorkspaceRoot();
        const git = simpleGit(root);
        await git.reset(['HEAD', target]);

        return {
            unstaged: true,
            filePath: target,
        };
    };

    const revertFile = async ({ filePath }) => {
        const target = String(filePath || '').trim();
        if (!target) {
            throw new Error('filePath is required.');
        }

        const root = getWorkspaceRoot();
        const git = simpleGit(root);

        try {
            await git.checkout([target]);
        } catch {
            const absPath = path.join(root, target);
            if (fs.existsSync(absPath)) {
                fs.rmSync(absPath, { force: true });
            } else {
                throw new Error(`Cannot revert ${target}: not tracked by git and not found on disk.`);
            }
        }

        return {
            reverted: true,
            filePath: target,
        };
    };

    const stageAll = async () => {
        const root = getWorkspaceRoot();
        const git = simpleGit(root);
        await git.add(['-A']);

        return {
            stagedAll: true,
        };
    };

    const unstageAll = async () => {
        const root = getWorkspaceRoot();
        const git = simpleGit(root);
        await git.reset(['HEAD']);

        return {
            unstagedAll: true,
        };
    };

    const revertAll = async () => {
        const root = getWorkspaceRoot();
        const git = simpleGit(root);
        await git.checkout(['.']);
        await git.raw(['clean', '-fd']).catch(() => {});

        return {
            revertedAll: true,
        };
    };

    const getDiffContent = async ({ filePath }) => {
        const target = String(filePath || '').trim();
        if (!target) {
            throw new Error('filePath is required.');
        }

        const root = getWorkspaceRoot();
        const git = simpleGit(root);

        let original = '';
        try {
            original = await git.show([`HEAD:${target}`]);
        } catch {
            original = '';
        }

        let modified = '';
        const absolutePath = normalizeInsideRoot(root, path.join(root, target));
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
            modified = fs.readFileSync(absolutePath, 'utf-8');
        }

        return {
            filePath: target,
            original,
            modified,
        };
    };

    return {
        listProjectTree,
        readProjectFile,
        getGitStatus,
        commitChanges,
        stageFile,
        unstageFile,
        revertFile,
        stageAll,
        unstageAll,
        revertAll,
        getDiffContent,
    };
};
