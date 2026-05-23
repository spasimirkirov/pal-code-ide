import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import { ensureModelLoaded } from './lm-studio-service.js';

const resolveOpencodeBinary = () => {
    try {
        const pkgPath = require.resolve('opencode-ai/package.json');
        const binDir = path.dirname(pkgPath);
        const candidate = path.join(binDir, 'bin', 'opencode.exe');
        if (fs.existsSync(candidate)) return candidate;
    } catch { /* fall through */ }
    return 'opencode';
};

const MAX_CONTEXT_TOKENS = 16000;
const CHARS_PER_TOKEN = 4;

const estimateTokens = (str) => Math.ceil(String(str || '').length / CHARS_PER_TOKEN);

const truncateHistory = (history, budget) => {
    if (!Array.isArray(history) || history.length === 0) return [];
    let total = history.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    if (total <= budget) return history;
    const truncated = [...history];
    while (truncated.length > 1 && total > budget) {
        const removed = truncated.shift();
        total -= estimateTokens(removed.content);
    }
    return truncated;
};

const createOpencodeService = ({ getMainWindow }) => {
    const logger = console;
    let server = null;
    let client = null;
    let serverUrl = null;
    const opencodeBinary = resolveOpencodeBinary();
    const activeSessions = new Map();
    let lastOpencodeConfig = null;

    const emit = (channel, payload) => {
        const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    };

    const checkAvailable = async () => {
        try {
            const stdout = execSync(`"${opencodeBinary}" --version`, { encoding: 'utf-8', timeout: 10000, windowsHide: true });
            const version = String(stdout || '').trim();
            return { available: true, version: version || 'unknown' };
        } catch (err) {
            return { available: false, version: null, error: String(err?.message || 'opencode CLI not found') };
        }
    };

    const buildServerConfig = (settings) => {
        const lmStudio = settings?.lmStudio || {};
        const opencode = settings?.opencode || {};

        const endpointUrl = String(lmStudio.endpointUrl || 'http://localhost:1234').replace(/\/+$/, '');
        const activeModel = String(opencode.model || lmStudio.activeModel || '').trim();
        if (!activeModel) return null;

        const useApiKey = opencode.useApiKey === true;
        const apiKey = useApiKey ? String(opencode.apiKey || '') : 'noop';

        const modelId = activeModel.split(/[\\/]/).pop() || activeModel;
        const providerId = 'lm-studio';

        return {
            model: `${providerId}/${modelId}`,
            provider: {
                [providerId]: {
                    api: 'openai',
                    name: 'LM Studio',
                    options: {
                        baseURL: `${endpointUrl}/v1`,
                        apiKey,
                    },
                    models: {
                        [modelId]: {
                            id: modelId,
                            name: modelId,
                            tool_call: true,
                            limit: { context: MAX_CONTEXT_TOKENS, output: 8192 },
                        },
                    },
                },
            },
        };
    };

    const startServer = async ({ settings } = {}) => {
        if (server && serverUrl) return { url: serverUrl };

        const opencodeConfig = buildServerConfig(settings);
        lastOpencodeConfig = opencodeConfig;

        return new Promise((resolve, reject) => {
            const args = ['serve', '--hostname=127.0.0.1', '--port=0'];
            if (process.env.PAL_LOG_LEVEL === 'debug') args.push('--log-level=debug');

            const envConfig = opencodeConfig ? JSON.stringify(opencodeConfig) : undefined;

            const childEnv = {
                ...process.env,
                ...(envConfig ? { OPENCODE_CONFIG_CONTENT: envConfig } : {}),
            };
            delete childEnv.OPENCODE_SERVER_PASSWORD;
            delete childEnv.OPENCODE_SERVER_USERNAME;

            const proc = spawn(opencodeBinary, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
                env: childEnv,
            });

            let output = '';
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    proc.kill();
                    reject(new Error('Timeout waiting for opencode server to start (15s)'));
                }
            }, 15000);

            proc.stdout.on('data', (chunk) => {
                if (resolved) return;
                output += String(chunk);
                const lines = output.split('\n');
                for (const line of lines) {
                    if (line.startsWith('opencode server listening')) {
                        const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
                        if (match) {
                            clearTimeout(timeout);
                            resolved = true;
                            serverUrl = match[1];
                            server = {
                                proc,
                                close: () => {
                                    try { proc.kill(); } catch { /* */ }
                                    server = null;
                                    serverUrl = null;
                                    client = null;
                                },
                            };
                            resolve({ url: serverUrl, config: opencodeConfig });
                            return;
                        }
                    }
                }
            });

            proc.stderr.on('data', (chunk) => {
                output += String(chunk);
            });

            proc.on('exit', (code) => {
                if (!resolved) {
                    clearTimeout(timeout);
                    reject(new Error(`opencode server exited with code ${code}:\n${output}`));
                }
            });

            proc.on('error', (err) => {
                if (!resolved) {
                    clearTimeout(timeout);
                    reject(new Error(`Failed to start opencode: ${err.message}`));
                }
            });
        });
    };

    const ensureClient = async (workspaceRoot) => {
        if (client) return client;
        const { url } = await startServer();
        const mod = await import('@opencode-ai/sdk/v2/client');
        client = mod.createOpencodeClient({
            baseUrl: url,
            directory: workspaceRoot || undefined,
        });
        return client;
    };

    const stopServer = () => {
        if (server) {
            for (const [traceId] of activeSessions) {
                abortSession(traceId);
            }
            server.close();
            server = null;
            serverUrl = null;
            client = null;
        }
    };

    const abortSession = (traceId) => {
        const session = activeSessions.get(traceId);
        if (!session) return;
        session.abortController.abort();
        if (client && session.sessionId) {
            client.session.abort({ sessionID: session.sessionId }).catch(() => {});
        }
        activeSessions.delete(traceId);
    };

    const processSseEvents = async ({ eventStream, sessionId, traceId, collectedActions }) => {
        const result = { fullText: '', error: null };
        try {
            for await (const evt of eventStream) {
                const props = evt?.properties || evt;
                if (props?.sessionID && props.sessionID !== sessionId) continue;

                const eventType = evt?.type || evt?.event || '';

                switch (eventType) {
                    case 'session.next.text.delta':
                    case 'text-delta':
                        result.fullText += props?.delta || props?.text || '';
                        emit('ai:stream-chunk', { traceId, text: props?.delta || props?.text || '' });
                        break;
                    case 'session.next.text.ended':
                    case 'text-ended':
                        if (props?.text) result.fullText = props.text;
                        break;
                    case 'session.next.reasoning.delta':
                    case 'reasoning-delta':
                        emit('ai:thinking-chunk', { traceId, text: props?.delta || props?.text || '' });
                        break;
                    case 'session.next.tool.called':
                    case 'tool-called':
                        collectedActions.push({
                            tool: props?.tool || '',
                            callID: props?.callID || '',
                            input: props?.input || {},
                        });
                        emit('ai:native-action', {
                            traceId,
                            action: { id: props?.callID, tool: props?.tool, input: props?.input },
                        });
                        break;
                    case 'session.next.tool.success':
                    case 'tool-success':
                        emit('ai:action-result', {
                            traceId,
                            actionId: props?.callID,
                            result: { ok: true, output: props?.content },
                        });
                        break;
                    case 'session.next.tool.failed':
                    case 'tool-failed':
                        emit('ai:action-result', {
                            traceId,
                            actionId: props?.callID,
                            result: { ok: false, error: props?.error?.message || 'Tool failed' },
                        });
                        break;
                    case 'session.idle':
                    case 'idle':
                        return result;
                }
            }
        } catch (err) {
            if (err?.name === 'AbortError') return result;
            result.error = err;
        }
        return result;
    };

    const sendMessage = async ({ traceId, prompt, history, settings }) => {
        const abortController = new AbortController();
        const workspaceRoot = settings?.workspaceRoot;
        let sessionId = '';

        try {
            const opencodeConfig = buildServerConfig(settings);
            if (!opencodeConfig) {
                const msg = 'OpenCode requires an LM Studio model to be selected. Go to Settings > AI Assistant > OpenCode and pick a model.';
                emit('ai:done', { traceId, text: msg, actions: [], nativeActions: [] });
                return { text: msg, actions: [], nativeActions: [] };
            }

            if (settings?.lmStudio?.activeModel) {
                ensureModelLoaded(settings, settings.lmStudio.activeModel).catch((err) => {
                    logger.warn('[opencode] Model auto-load failed:', err?.message);
                });
            }

            const c = await ensureClient(workspaceRoot);

            if (lastOpencodeConfig && JSON.stringify(lastOpencodeConfig) !== JSON.stringify(opencodeConfig)) {
                logger.info('[opencode] Config changed, restarting server with new provider config');
                stopServer();
                const { url } = await startServer({ settings });
                const mod = await import('@opencode-ai/sdk/v2/client');
                client = mod.createOpencodeClient({
                    baseUrl: url,
                    directory: workspaceRoot || undefined,
                });
            }

            const budget = MAX_CONTEXT_TOKENS - estimateTokens(prompt) - 2000;
            const trimmedHistory = truncateHistory(history || [], Math.max(budget, 1000));

            const historyText = trimmedHistory
                .map((m) => `${m.role}: ${m.content}`)
                .join('\n\n');

            const fullPrompt = historyText
                ? `Previous conversation:\n${historyText}\n\nUser: ${prompt}`
                : prompt;

            const session = await c.session.create({
                title: (prompt || '').slice(0, 80),
            });
            sessionId = String(session?.data?.id || '');
            if (!sessionId) throw new Error('OpenCode session creation returned no ID');

            activeSessions.set(traceId, { sessionId, abortController });

            const collectedActions = [];

            let eventResult;
            try {
                eventResult = await c.event.subscribe(
                    { directory: workspaceRoot || undefined },
                    { signal: abortController.signal },
                );
            } catch (subscribeErr) {
                logger.warn('[opencode] SSE subscribe failed (non-fatal):', subscribeErr?.message);
            }

            const ssePromise = eventResult
                ? processSseEvents({ eventStream: eventResult.stream, sessionId, traceId, collectedActions })
                : Promise.resolve({ fullText: '', error: null });

            const modelStr = opencodeConfig.model || '';
            const slashIdx = modelStr.indexOf('/');
            const providerID = slashIdx >= 0 ? modelStr.slice(0, slashIdx) : 'lm-studio';
            const modelID = slashIdx >= 0 ? modelStr.slice(slashIdx + 1) : modelStr;

            const promptResult = await c.session.prompt({
                sessionID: sessionId,
                parts: [{ type: 'text', text: String(fullPrompt || '') }],
                model: { providerID, modelID },
            });

            abortController.abort();

            const sseResult = await ssePromise;
            let fullText = sseResult.fullText || '';

            if (!fullText && promptResult?.data) {
                const data = promptResult.data;
                if (data.role === 'assistant' && Array.isArray(data.parts)) {
                    fullText = data.parts
                        .filter((p) => p?.type === 'text')
                        .map((p) => String(p?.text || ''))
                        .join('\n');
                }
            }

            if (!fullText) {
                for (let i = 0; i < 5; i++) {
                    const msgResult = await c.session.messages({ sessionID: sessionId });
                    const items = Array.isArray(msgResult?.data) ? msgResult.data : [];
                    const lastAssistant = items.findLast
                        ? items.findLast((m) => m?.role === 'assistant')
                        : [...items].reverse().find((m) => m?.role === 'assistant');
                    if (lastAssistant && Array.isArray(lastAssistant.parts)) {
                        fullText = lastAssistant.parts
                            .filter((p) => p?.type === 'text')
                            .map((p) => String(p?.text || ''))
                            .join('\n');
                        if (fullText) break;
                    }
                    if (i < 4) await new Promise((r) => setTimeout(r, 1000));
                }
            }

            if (!fullText) {
                fullText = `OpenCode returned no response. Make sure LM Studio is running with model "${opencodeConfig.model}" loaded on ${settings?.lmStudio?.endpointUrl || 'http://localhost:1234'}.`;
            }

            emit('ai:done', {
                traceId,
                text: fullText,
                actions: collectedActions,
                nativeActions: collectedActions,
            });

            return { text: fullText, actions: collectedActions, nativeActions: collectedActions };
        } catch (err) {
            const error = String(err?.message || 'OpenCode request failed');
            emit('ai:error', { traceId, error, recoverable: false });
            return { text: '', error };
        } finally {
            activeSessions.delete(traceId);
        }
    };

    return {
        checkAvailable,
        startServer,
        stopServer,
        sendMessage,
        abortSession,
        getActiveSessions: () => Array.from(activeSessions.keys()),
        getServerConfig: () => lastOpencodeConfig,
    };
};

export { createOpencodeService };
