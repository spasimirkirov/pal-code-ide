import fs from 'node:fs';
import path from 'node:path';

export const createWorkspaceService = (defaultWorkspaceRoot = process.cwd()) => {
    const fallback = path.resolve(defaultWorkspaceRoot);
    let activeWorkspaceRoot = fallback;

    const resolveWorkspaceRoot = (candidatePath) => {
        if (!candidatePath || typeof candidatePath !== 'string') {
            return fallback;
        }

        const resolved = path.resolve(candidatePath);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            return fallback;
        }

        return resolved;
    };

    const setWorkspaceRoot = (candidatePath) => {
        activeWorkspaceRoot = resolveWorkspaceRoot(candidatePath);
        return activeWorkspaceRoot;
    };

    const getWorkspaceRoot = () => activeWorkspaceRoot;

    return {
        getWorkspaceRoot,
        setWorkspaceRoot,
        resolveWorkspaceRoot,
    };
};
