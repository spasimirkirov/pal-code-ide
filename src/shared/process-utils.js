import { execFile } from 'node:child_process';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const killProcessTree = async (pid) => {
    if (!pid) {
        return;
    }

    if (process.platform === 'win32') {
        await new Promise((resolve) => {
            execFile('taskkill', ['/pid', String(pid), '/t', '/f'], () => resolve());
        });
        return;
    }

    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        // Ignore missing process
    }
};
