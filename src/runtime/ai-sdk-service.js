const { createOpenAI } = require('@ai-sdk/openai');
const { streamText } = require('ai');
const pino = require('pino');
const { trace } = require('@opentelemetry/api');

const toolTracer = trace.getTracer('pal.ai.tools');

const createAiSdkService = () => {
    const logger = pino({ name: 'pal-ai-sdk-tools', level: process.env.PAL_LOG_LEVEL || 'info' });

    const classifyStreamError = (message) => {
        const text = String(message || '');
        if (/No user query found in messages/i.test(text) || /jinja template/i.test(text) || /prompt template/i.test(text)) {
            return { code: 'template-mismatch', text };
        }
        return { code: '', text };
    };

    const createProvider = ({ settings }) => {
        const endpointUrl = String(settings?.lmStudio?.endpointUrl || 'http://localhost:1234').replace(/\/+$/, '');
        const baseURL = `${endpointUrl}/v1`;
        const modelId = String(settings?.lmStudio?.activeModel || '');
        return { client: createOpenAI({ baseURL, apiKey: 'noop' }), modelId };
    };

    const sendPrompt = async ({ traceId, systemPrompt, messages, settings, emit, maxTokens = 8192, suppressStreamingText = false }) => {
        const { client, modelId } = createProvider({ settings });
        const model = client(modelId);

        const filteredMessages = Array.isArray(messages) ? messages.filter((m) => m.role !== 'system') : [];

        const result = streamText({
            model,
            system: systemPrompt,
            messages: filteredMessages,
            maxTokens,
        });

        let fullText = '';

        try {
            for await (const event of result.fullStream) {
                if (event.type === 'text-delta') {
                    fullText += event.textDelta;
                    if (!suppressStreamingText) {
                        emit('ai:stream-chunk', { traceId, text: event.textDelta });
                    }
                } else if (event.type === 'error') {
                    const msg = String(event.error?.message || 'Stream error');
                    const classified = classifyStreamError(msg);
                    emit('ai:error', {
                        traceId,
                        error: classified.text,
                        errorCode: classified.code,
                        recoverable: classified.code !== 'template-mismatch',
                    });
                }
            }
        } catch (streamErr) {
            const message = String(streamErr?.message || 'Stream failed');
            const classified = classifyStreamError(message);
            if (classified.code) {
                return { text: fullText, modelError: classified.text, modelErrorCode: classified.code };
            }
            logger.error({ traceId, error: message }, 'sendPrompt stream failed');
            return { text: fullText };
        }

        return { text: fullText, toolCalls: [] };
    };

    return { sendPrompt };
};

module.exports = { createAiSdkService };
