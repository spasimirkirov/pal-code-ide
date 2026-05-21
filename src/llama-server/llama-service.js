import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { sleep, killProcessTree } from '../shared/process-utils';

const LLAMA_HOST = process.env.PAL_LLAMA_HOST || '127.0.0.1';
const LLAMA_PORT = Number(process.env.PAL_LLAMA_PORT || 1234);
const LLAMA_HEALTH_URL = `http://${LLAMA_HOST}:${LLAMA_PORT}/health`;

export const createLlamaService = ({ getWorkspaceRoot, getRuntimePaths }) => {
    let llamaProcess = null;
    let llamaState = {
        status: 'stopped',
        ready: false,
        pid: null,
        message: 'Server is offline.',
        recentOutput: '',
    };

    const appendOutput = (chunk) => {
        const combined = `${llamaState.recentOutput}\n${chunk}`.trim();
        llamaState.recentOutput = combined.slice(-14000);
    };

    const checkPortOpen = () =>
        new Promise((resolve) => {
            const socket = new net.Socket();
            let settled = false;

            const finish = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                socket.destroy();
                resolve(result);
            };

            socket.setTimeout(700);
            socket.once('connect', () => finish(true));
            socket.once('timeout', () => finish(false));
            socket.once('error', () => finish(false));
            socket.connect(LLAMA_PORT, LLAMA_HOST);
        });

    const checkHttpReady = async () => {
        try {
            const response = await fetch(LLAMA_HEALTH_URL, { method: 'GET' });
            return response.ok;
        } catch {
            return false;
        }
    };

    const detectReadyFromOutput = () => {
        const output = llamaState.recentOutput.toLowerCase();
        return (
            output.includes('listening on') ||
            output.includes('server is listening') ||
            output.includes('http server listening')
        );
    };

    const resolveLlamaCommand = () => {
        const paths = getRuntimePaths();

        const findExecutableInDir = (dirPath) => {
            if (!fs.existsSync(dirPath)) {
                return null;
            }

            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isFile() && entry.name.toLowerCase() === 'llama-server.exe') {
                    return fullPath;
                }
                if (entry.isDirectory()) {
                    const nested = findExecutableInDir(fullPath);
                    if (nested) {
                        return nested;
                    }
                }
            }

            return null;
        };

        const resolveManagedExecutable = () => {
            const activeManifestPath = path.join(paths.llamaServerDir, 'active.json');
            if (fs.existsSync(activeManifestPath)) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(activeManifestPath, 'utf-8'));
                    const candidate = parsed?.executablePath;
                    if (candidate && fs.existsSync(candidate)) {
                        return candidate;
                    }
                } catch {
                    // Ignore manifest parse errors and fallback to scanning directories.
                }
            }

            const preferredFlavor = (process.env.PAL_LLAMA_BINARY_FLAVOR || 'auto').toLowerCase();
            const flavorOrder =
                preferredFlavor === 'cuda'
                    ? ['cuda', 'cpu', 'vulkan']
                    : preferredFlavor === 'vulkan'
                        ? ['vulkan', 'cpu', 'cuda']
                        : preferredFlavor === 'cpu'
                            ? ['cpu', 'cuda', 'vulkan']
                            : ['cuda', 'cpu', 'vulkan'];

            for (const flavor of flavorOrder) {
                const flavorPath = path.join(paths.llamaServerDir, flavor);
                const found = findExecutableInDir(flavorPath);
                if (found) {
                    return found;
                }
            }

            return paths.llamaExe;
        };

        const executable = process.env.PAL_LLAMA_SERVER_PATH || resolveManagedExecutable();
        const modelPath = process.env.PAL_LLAMA_MODEL_PATH || '';
        const extraArgsRaw = process.env.PAL_LLAMA_EXTRA_ARGS || '';
        const extraArgs = extraArgsRaw.trim() ? extraArgsRaw.trim().split(/\s+/) : [];

        const baseArgs = ['--host', LLAMA_HOST, '--port', String(LLAMA_PORT)];
        if (modelPath) {
            baseArgs.push('--model', modelPath);
        }

        return {
            executable,
            args: [...baseArgs, ...extraArgs],
        };
    };

    const waitForLlamaReady = async (timeoutMs = 180000) => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            if (!llamaProcess || llamaProcess.killed) {
                const outputTail = llamaState.recentOutput.slice(-1000).trim();
                throw new Error(
                    `Llama process exited before it became ready.${outputTail ? ` Recent output: ${outputTail}` : ''}`,
                );
            }

            const [portOpen, healthOk] = await Promise.all([checkPortOpen(), checkHttpReady()]);
            if ((portOpen && healthOk) || (portOpen && detectReadyFromOutput())) {
                llamaState = {
                    ...llamaState,
                    status: 'running',
                    ready: true,
                    pid: llamaProcess.pid,
                    message: 'Llama server is ready on port 1234.',
                };
                return llamaState;
            }

            await sleep(900);
        }

        throw new Error('Timed out waiting for Llama to initialize on port 1234.');
    };

    const getLlamaStatus = async () => {
        const portOpen = await checkPortOpen();
        const healthOk = await checkHttpReady();
        const ready = portOpen && healthOk;

        if (ready && llamaState.status !== 'running') {
            llamaState = {
                ...llamaState,
                status: 'running',
                ready: true,
                message: 'Detected active Llama server.',
            };
        }

        if (!portOpen && llamaState.status === 'running' && !llamaProcess) {
            llamaState = {
                ...llamaState,
                status: 'stopped',
                ready: false,
                pid: null,
                message: 'Server is offline.',
            };
        }

        return {
            ...llamaState,
            portOpen,
            healthOk,
            cwd: getWorkspaceRoot(),
        };
    };

    const startLlama = async () => {
        if (llamaState.status === 'starting') {
            return llamaState;
        }

        const currentStatus = await getLlamaStatus();
        if (currentStatus.ready) {
            return currentStatus;
        }

        const { executable, args } = resolveLlamaCommand();
        if (!fs.existsSync(executable)) {
            throw new Error(`llama-server executable not found at ${executable}. Complete runtime setup first.`);
        }

        llamaState = {
            ...llamaState,
            status: 'starting',
            ready: false,
            message: 'Loading Model into VRAM...',
            recentOutput: '',
        };

        const child = spawn(executable, args, {
            cwd: path.dirname(executable),
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        llamaProcess = child;
        llamaState.pid = child.pid || null;

        child.stdout?.on('data', (data) => {
            appendOutput(String(data));
        });

        child.stderr?.on('data', (data) => {
            appendOutput(String(data));
        });

        child.on('exit', (code) => {
            llamaProcess = null;
            if (llamaState.status !== 'stopped') {
                llamaState = {
                    ...llamaState,
                    status: 'stopped',
                    ready: false,
                    pid: null,
                    message: `Llama process exited with code ${code ?? 'unknown'}.`,
                };
            }
        });

        try {
            return await waitForLlamaReady();
        } catch (error) {
            await killProcessTree(child.pid);
            llamaProcess = null;
            llamaState = {
                ...llamaState,
                status: 'error',
                ready: false,
                pid: null,
                message: error.message,
            };
            throw error;
        }
    };

    const stopLlama = async () => {
        llamaState = {
            ...llamaState,
            status: 'stopping',
            ready: false,
            message: 'Stopping Llama server...',
        };

        if (llamaProcess?.pid) {
            await killProcessTree(llamaProcess.pid);
            llamaProcess = null;
        }

        llamaState = {
            ...llamaState,
            status: 'stopped',
            ready: false,
            pid: null,
            message: 'Server is offline.',
        };

        return getLlamaStatus();
    };

    const shutdown = async () => {
        if (llamaProcess?.pid) {
            await killProcessTree(llamaProcess.pid);
        }
    };

    return {
        getLlamaStatus,
        startLlama,
        stopLlama,
        shutdown,
    };
};
