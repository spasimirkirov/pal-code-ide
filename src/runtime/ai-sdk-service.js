const { createOpenAI } = require('@ai-sdk/openai');
const { streamText, tool, jsonSchema } = require('ai');
const pino = require('pino');
const PRetryModule = require('p-retry');
const { LRUCache } = require('lru-cache');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const { WORKSPACE_TOOL_DEFINITIONS, validateAndNormalizeToolArgs, getApprovalTypeForActionType } = require('../utils/toolRegistry');
const { ensureModelLoaded } = require('./lm-studio-service');

const pRetry = PRetryModule.default || PRetryModule;
const toolTracer = trace.getTracer('pal.ai.tools');

const createAiSdkService = () => {
    const logger = pino({ name: 'pal-ai-sdk-tools', level: process.env.PAL_LOG_LEVEL || 'info' });

    const createProvider = ({ settings }) => {
        const baseURL = `${settings.lmStudio.endpointUrl.replace(/\/+$/, '')}/v1`;
        const rawModelId = settings.lmStudio.activeModel;
        const modelId = rawModelId.split(/[\\/]/).pop() || rawModelId;
        return { client: createOpenAI({ baseURL, apiKey: 'noop' }), modelId };
    };

    const buildSdkTools = (deps) => {
        const { traceId, executeAction, requestApproval, onPending, onToolExecution } = deps;
        const tools = {};
        const readPathCounts = new Map();
        const repeatedCallCache = new LRUCache({ max: 250, ttl: 10 * 60 * 1000 });

        const getCallFingerprint = (toolName, action) => {
            const json = JSON.stringify({ toolName, action });
            return `${toolName}:${json}`;
        };

        const MAX_RESULT_CHARS = 8000;

        const truncateToolResult = (result) => {
            if (!result || typeof result !== 'object') return result;
            const truncated = { ...result };
            for (const [key, value] of Object.entries(truncated)) {
                if (typeof value === 'string' && value.length > MAX_RESULT_CHARS) {
                    truncated[key] = value.slice(0, MAX_RESULT_CHARS) + `\n... [truncated: ${value.length - MAX_RESULT_CHARS} chars exceeded limit]`;
                }
            }
            return truncated;
        };

        for (const def of WORKSPACE_TOOL_DEFINITIONS) {
            const name = def.name;
            tools[name] = tool({
                description: def.description,
                parameters: jsonSchema(def.parameters),
                execute: async (args) => {
                    const validation = validateAndNormalizeToolArgs({ toolName: name, args });
                    if (!validation.ok) {
                        return { ok: false, error: validation.error || 'Tool validation failed.' };
                    }
                    const action = validation.normalized;

                    // Guardrail against endless read-file loops on the same path.
                    if (action.type === 'read-file') {
                        const readPath = String(action.path || '').trim().toLowerCase();
                        const nextCount = (readPathCounts.get(readPath) || 0) + 1;
                        readPathCounts.set(readPath, nextCount);
                        if (readPath && nextCount > 2) {
                            return {
                                ok: false,
                                error: `Redundant read-file blocked for path "${action.path}" after ${nextCount - 1} successful attempts. Continue by applying edit tools to implement the requested change.`,
                            };
                        }
                    }

                    const approvalType = getApprovalTypeForActionType(action.type);
                    const actionId = `${traceId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
                    const actionWithId = { ...action, actionId };

                    if (onPending) onPending({ traceId, action: actionWithId });

                    const fingerprint = getCallFingerprint(name, action);
                    const previousCount = repeatedCallCache.get(fingerprint) || 0;
                    repeatedCallCache.set(fingerprint, previousCount + 1);
                    if (previousCount >= 3) {
                        const loopError = `Repeated tool call blocked for ${name}. The same call signature was attempted ${previousCount + 1} times.`;
                        logger.warn({ traceId, tool: name, action }, loopError);
                        if (typeof onToolExecution === 'function') {
                            onToolExecution({
                                traceId,
                                toolName: name,
                                actionType: action.type,
                                ok: false,
                                error: loopError,
                                blockedLoop: true,
                            });
                        }
                        return { ok: false, error: loopError };
                    }

                    if (approvalType === 'terminal') {
                        const approved = await requestApproval(actionId, traceId);
                        if (!approved) {
                            return { ok: false, error: 'Command rejected by user.' };
                        }
                    }

                    const span = toolTracer.startSpan('tool.execute', {
                        attributes: {
                            'pal.trace_id': traceId,
                            'pal.tool_name': name,
                            'pal.action_type': String(action.type || ''),
                        },
                    });

                    const startedAt = Date.now();

                    try {
                        const result = await pRetry(
                            async () => {
                                const toolResult = await executeAction({ action: actionWithId, traceId });
                                if (!toolResult || toolResult.ok === false) {
                                    const reason = toolResult?.error || 'Action returned no result.';
                                    throw new Error(String(reason));
                                }
                                return toolResult;
                            },
                            {
                                retries: 2,
                                minTimeout: 100,
                                maxTimeout: 800,
                                factor: 2,
                            },
                        );

                        const truncatedResult = truncateToolResult(result);

                        span.setStatus({ code: SpanStatusCode.OK });
                        logger.info({ traceId, tool: name, ms: Date.now() - startedAt }, 'Tool execution succeeded');
                        if (typeof onToolExecution === 'function') {
                            onToolExecution({
                                traceId,
                                toolName: name,
                                actionType: action.type,
                                ok: true,
                                ms: Date.now() - startedAt,
                                resultSummary: result?.path || result?.resultCount || '',
                            });
                        }
                        return truncatedResult;
                    } catch (error) {
                        const message = String(error?.message || 'Action returned no result.');
                        span.setStatus({ code: SpanStatusCode.ERROR, message });
                        span.recordException(error);
                        logger.warn({ traceId, tool: name, ms: Date.now() - startedAt, error: message }, 'Tool execution failed');
                        if (typeof onToolExecution === 'function') {
                            onToolExecution({
                                traceId,
                                toolName: name,
                                actionType: action.type,
                                ok: false,
                                ms: Date.now() - startedAt,
                                error: message,
                            });
                        }
                        return { ok: false, error: message };
                    } finally {
                        span.end();
                    }
                },
            });
        }
        return tools;
    };

    const sendPrompt = async ({ traceId, systemPrompt, messages, settings, tools, emit, maxSteps = 6, toolChoice, maxTokens = 8192 }) => {
        if (settings?.lmStudio?.activeModel) {
            ensureModelLoaded(settings, settings.lmStudio.activeModel).catch((err) => {
                logger.warn({ traceId, error: err.message }, 'Model auto-load failed, proceeding anyway');
            });
        }
        const { client, modelId } = createProvider({ settings });
        const model = client(modelId);

        const streamOptions = {
            model,
            system: systemPrompt,
            messages,
            tools,
            maxSteps,
            maxTokens,
        };

        if (toolChoice) {
            streamOptions.toolChoice = toolChoice;
        }

        const result = streamText(streamOptions);

        let fullText = '';
        const toolCalls = [];

        try {
            for await (const event of result.fullStream) {
                switch (event.type) {
                    case 'text-delta':
                        fullText += event.textDelta;
                        emit('ai:stream-chunk', { traceId, text: event.textDelta });
                        break;
                    case 'tool-call':
                        toolCalls.push({ toolName: event.toolName, args: event.args, toolCallId: event.toolCallId });
                        break;
                    case 'error':
                        emit('ai:error', { traceId, error: event.error?.message || 'Stream error', recoverable: true });
                        break;
                }
            }
        } catch (streamErr) {
            emit('ai:error', { traceId, error: streamErr.message, recoverable: false });
            return null;
        }

        return { text: fullText, toolCalls };
    };

    return { createProvider, buildSdkTools, sendPrompt };
};

module.exports = { createAiSdkService };
