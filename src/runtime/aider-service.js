import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const TOKENS_LINE_RE = /^Tokens:\s+\d+\s+sent,\s+\d+\s+received\.?$/;
const HEADER_END_RE = /^\s*-{3,}\s*$/;
const AIDER_PROMPT_RE = /^>\s*$/;

const stripAnsi = (text) => text.replace(ANSI_RE, '');

export const createAiderService = ({ getWorkspaceRoot, getMainWindow }) => {
    const emit = (channel, payload) => {
        const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    };

    const checkAvailable = async () => {
        return new Promise((resolve) => {
            const child = spawn('aider', ['--version'], {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
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

    const buildArgs = (modelName, apiBase) => {
        const args = [
            '--no-auto-commits',
            '--no-suggest-shell-commands',
            '--no-pretty',
            '--yes-always',
            '--no-show-model-warnings',
            '--no-git',
            '--model', `openai/${modelName}`,
            '--openai-api-base', apiBase,
        ];

        return args;
    };

    const sendMessage = async ({ traceId, prompt, settings, workspaceRoot }) => {
        const modelName = settings?.lmStudio?.activeModel;

        if (!modelName) {
            emit('ai:error', { traceId, error: 'No model configured for Aider.', recoverable: false });
            return;
        }

        const apiBase = (settings?.lmStudio?.endpointUrl || 'http://localhost:1234') + '/v1';

        const root = workspaceRoot || (typeof getWorkspaceRoot === 'function' ? getWorkspaceRoot() : null) || process.cwd();

        return new Promise((resolve) => {
            const env = { ...process.env };
            env.OPENAI_API_KEY = env.OPENAI_API_KEY || 'not-needed';
            env.AIDER_OPENAI_API_BASE = apiBase;

            const args = buildArgs(modelName, apiBase);
            const tmpFile = path.join(root, `.aider-msg-${traceId || Date.now()}.md`);
            fs.writeFileSync(tmpFile, prompt, 'utf-8');
            args.push('--message-file', tmpFile);

            const child = spawn('aider', args, {
                cwd: root,
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
            });

            child.on('close', () => {
                try { fs.unlinkSync(tmpFile); } catch { /* */ }
            });

            let stdout = '';
            let stderr = '';
            let headerDone = false;

            child.stdout.on('data', (data) => {
                const text = String(data);
                stdout += text;

                const clean = stripAnsi(text);
                const lines = clean.split('\n');

                for (const line of lines) {
                    if (!headerDone) {
                        if (HEADER_END_RE.test(line.trim())) {
                            headerDone = true;
                        }
                        continue;
                    }
                    const trimmed = line.trim();
                    if (!trimmed || TOKENS_LINE_RE.test(trimmed) || AIDER_PROMPT_RE.test(trimmed)) {
                        continue;
                    }
                    emit('ai:stream-chunk', { traceId, text: trimmed + '\n' });
                }
            });

            child.stderr.on('data', (data) => {
                stderr += String(data);
            });

            child.on('close', (code) => {
                const cleanStdout = stripAnsi(stdout);
                const body = extractResponseBody(cleanStdout);

                if (code === 0 && body) {
                    emit('ai:done', { traceId, text: body, actions: [], nativeActions: [] });
                    resolve({ text: body, actions: [], nativeActions: [] });
                } else {
                    const error = stderr.trim() || 'Aider exited with code ' + code;
                    emit('ai:error', { traceId, error, recoverable: false });
                    resolve({ text: '', error });
                }
            });

            child.on('error', (err) => {
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

    return { checkAvailable, sendMessage };
};
