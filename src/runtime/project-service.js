import fs from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';

const IGNORED_NAMES = new Set(['.git', 'node_modules', '.vite', 'dist', 'out']);

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
    const buildTreeNode = (absolutePath, rootPath) => {
        const stat = fs.statSync(absolutePath);
        const relative = path.relative(rootPath, absolutePath) || '.';
        const node = {
            id: relative,
            name: path.basename(absolutePath) || path.basename(rootPath),
            path: absolutePath,
            relativePath: relative,
            isDirectory: stat.isDirectory(),
        };

        if (stat.isDirectory()) {
            const entries = fs
                .readdirSync(absolutePath, { withFileTypes: true })
                .filter((entry) => !IGNORED_NAMES.has(entry.name));

            node.children = sortEntries(entries).map((entry) =>
                buildTreeNode(path.join(absolutePath, entry.name), rootPath),
            );
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
        const staged = [];
        const unstaged = [];

        for (const file of status.files) {
            const label = file.path;
            if (file.index && file.index !== ' ') {
                staged.push({
                    path: label,
                    index: file.index,
                    workingDir: file.working_dir,
                });
            }
            if (file.working_dir && file.working_dir !== ' ') {
                unstaged.push({
                    path: label,
                    index: file.index,
                    workingDir: file.working_dir,
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
        await git.checkout([target]);

        return {
            reverted: true,
            filePath: target,
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
        getDiffContent,
    };
};
