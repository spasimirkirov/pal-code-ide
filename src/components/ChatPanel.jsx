import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Bolt, SendHorizontal, Sparkles, User } from 'lucide-react';

const runtime = window.palRuntime;
const LLAMA_CHAT_BASE_URL = 'http://127.0.0.1:1234';

const defaultAiSettings = {
    engine: 'llama-server',
    roleMappings: {
        coding: '',
        vision: '',
        autocomplete: '',
    },
    lmStudio: {
        endpointUrl: 'http://localhost:1234',
        port: '1234',
        activeModel: '',
    },
};

const buildLmStudioBaseUrl = (settings) => {
    const rawBase = String(settings?.lmStudio?.endpointUrl || 'http://localhost:1234').trim() || 'http://localhost:1234';
    const normalizedBase = /^https?:\/\//i.test(rawBase) ? rawBase : `http://${rawBase}`;
    const url = new URL(normalizedBase);
    const port = String(settings?.lmStudio?.port || '').trim();
    if (port) {
        url.port = port;
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
};

const normalizeModelId = (value) => {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    return text.split(/[\\/]/).pop() || text;
};

const requestOpenAiStyleChat = async ({ baseUrl, model, prompt }) => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: model || undefined,
            stream: false,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
        }),
    });

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.response ?? data?.text ?? '';
    return String(content || '');
};

const extractCodeBlocks = (text) => {
    if (!text) {
        return [];
    }

    const blocks = [];
    const regex = /```(?:\w+)?\n([\s\S]*?)```/g;
    let match = regex.exec(text);

    while (match) {
        blocks.push(match[1].trim());
        match = regex.exec(text);
    }

    return blocks.filter(Boolean);
};

function ChatPanel({ onApplyCode, workspaceRoot, onModelMetricsUpdate }) {
    const [messages, setMessages] = useState([
        {
            id: 'system-1',
            role: 'assistant',
            text: 'Agent online. Ask for architecture, refactors, or full-file code updates.',
            status: 'done',
        },
    ]);
    const [prompt, setPrompt] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [aiSettings, setAiSettings] = useState(defaultAiSettings);
    const viewportRef = useRef(null);

    useEffect(() => {
        let mounted = true;

        const hydrate = async () => {
            try {
                const settings = await runtime?.getAiAssistantSettings?.();
                if (mounted && settings) {
                    setAiSettings(settings);
                }
            } catch {
                // Keep defaults on settings load failure.
            }
        };

        void hydrate();
        return () => {
            mounted = false;
        };
    }, []);

    const autoScroll = () => {
        if (!viewportRef.current) {
            return;
        }

        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    };

    const appendChunk = (assistantId, chunkText) => {
        setMessages((current) =>
            current.map((msg) => {
                if (msg.id !== assistantId) {
                    return msg;
                }

                return {
                    ...msg,
                    text: `${msg.text}${chunkText}`,
                };
            }),
        );
    };

    const finishAssistant = (assistantId) => {
        setMessages((current) =>
            current.map((msg) =>
                msg.id === assistantId
                    ? {
                        ...msg,
                        status: 'done',
                    }
                    : msg,
            ),
        );
    };

    const sendPrompt = async (event) => {
        event.preventDefault();

        const startedAt = performance.now();

        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt || isSending) {
            return;
        }

        let effectivePrompt = trimmedPrompt;
        if (trimmedPrompt.startsWith('/web ') && runtime?.duckduckgoSearch) {
            const webQuery = trimmedPrompt.slice(5).trim();
            if (webQuery) {
                try {
                    const web = await runtime.duckduckgoSearch({
                        query: webQuery,
                        maxResults: 6,
                    });
                    const blocks = Array.isArray(web?.textBlocks) ? web.textBlocks.join('\n\n') : '';
                    if (blocks) {
                        effectivePrompt = `${webQuery}\n\nWeb context:\n${blocks}`;
                    }
                } catch {
                    // Continue without search augmentation if the tool fails.
                }
            }
        }

        const userId = `user-${Date.now()}`;
        const assistantId = `assistant-${Date.now()}`;

        setIsSending(true);
        setPrompt('');
        setMessages((current) => [
            ...current,
            { id: userId, role: 'user', text: trimmedPrompt, status: 'done' },
            { id: assistantId, role: 'assistant', text: '', status: 'streaming' },
        ]);

        try {
            const engine = aiSettings.engine === 'lm-studio' ? 'lm-studio' : 'llama-server';
            const targetBaseUrl = engine === 'lm-studio' ? buildLmStudioBaseUrl(aiSettings) : LLAMA_CHAT_BASE_URL;
            const targetModel =
                engine === 'lm-studio'
                    ? normalizeModelId(aiSettings?.lmStudio?.activeModel)
                    : normalizeModelId(aiSettings?.roleMappings?.coding);

            const streamedText = await requestOpenAiStyleChat({
                baseUrl: targetBaseUrl,
                model: targetModel,
                prompt: effectivePrompt,
            });

            appendChunk(assistantId, streamedText || 'No response text was returned.');
            finishAssistant(assistantId);
            setTimeout(autoScroll, 0);

            const responseTokens = Math.max(1, Math.round(streamedText.length / 4));
            const promptTokens = Math.max(1, Math.round(effectivePrompt.length / 4));
            const elapsedSec = Math.max(0.1, (performance.now() - startedAt) / 1000);
            onModelMetricsUpdate?.({
                tokensPerSec: Number((responseTokens / elapsedSec).toFixed(1)),
                contextUsed: promptTokens + responseTokens,
                contextTotal: 32000,
            });
        } catch (error) {
            setMessages((current) =>
                current.map((msg) =>
                    msg.id === assistantId
                        ? {
                            ...msg,
                            text: `Backend unavailable: ${error.message}`,
                            status: 'done',
                        }
                        : msg,
                ),
            );
        } finally {
            setIsSending(false);
            setTimeout(autoScroll, 0);
        }
    };

    const renderedMessages = useMemo(
        () =>
            messages.map((message) => {
                const isUser = message.role === 'user';
                const codeBlocks = extractCodeBlocks(message.text);
                const lastCodeBlock = codeBlocks[codeBlocks.length - 1];

                return (
                    <article
                        key={message.id}
                        className={`border p-2 ${isUser
                            ? 'ml-6 border-cyan-400/30 bg-cyan-400/8'
                            : 'mr-6 border-slate-700/70 bg-slate-900/70'
                            }`}
                    >
                        <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-400">
                            <span className="grid h-6 w-6 place-items-center rounded-full border border-slate-700/80 bg-slate-950">
                                {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5 text-cyan-200" />}
                            </span>
                            {isUser ? 'Operator' : 'PAL Agent'}
                            {message.status === 'streaming' && (
                                <span className="ml-1 inline-flex items-center gap-1 text-cyan-300">
                                    <Sparkles className="h-3 w-3 animate-pulse" />
                                    streaming
                                </span>
                            )}
                        </div>

                        <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-slate-100">
                            {message.text || (message.status === 'streaming' ? 'Thinking...' : '')}
                        </pre>

                        {!isUser && lastCodeBlock && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => onApplyCode(lastCodeBlock, 'overwrite')}
                                    className="rounded-lg border border-amber-300/35 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-amber-200 transition hover:bg-amber-300/20"
                                >
                                    Overwrite Editor
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onApplyCode(lastCodeBlock, 'insert')}
                                    className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-cyan-100 transition hover:bg-cyan-300/20"
                                >
                                    Inject Into Editor
                                </button>
                            </div>
                        )}
                    </article>
                );
            }),
        [messages, onApplyCode],
    );

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[#0f1319]">
            <div className="flex h-8 items-center justify-between border-b border-slate-800 px-3">
                <div>
                    <h2 className="text-xs font-semibold tracking-[0.08em] text-cyan-100">Agent Chat</h2>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-[10px] uppercase tracking-[0.08em] text-slate-400">🤖 Engine</label>
                    <select
                        value={aiSettings.engine}
                        onChange={(event) => {
                            const engine = event.target.value;
                            setAiSettings((current) => ({
                                ...current,
                                engine,
                            }));
                            void runtime?.setAiAssistantSettings?.({ engine });
                        }}
                        className="rounded-md border border-cyan-300/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-100"
                    >
                        <option value="llama-server">Llama Server</option>
                        <option value="lm-studio">LM Studio</option>
                    </select>
                </div>
            </div>

            <div ref={viewportRef} className="flex-1 space-y-2 overflow-y-auto p-2">
                {renderedMessages}
            </div>

            <form onSubmit={sendPrompt} className="border-t border-slate-800 bg-[#0d1218] p-2">
                <div className="flex items-end gap-2">
                    <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        rows={4}
                        placeholder="Ask PAL to generate, refactor, or patch code... Use /web <query> for search context."
                        className="max-h-72 min-h-[104px] flex-1 resize-y rounded-xl border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/45"
                    />
                    <button
                        type="submit"
                        disabled={isSending}
                        className="inline-flex h-[52px] items-center gap-2 rounded-xl border border-cyan-300/35 bg-cyan-400/15 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-55"
                        aria-label="Send prompt"
                    >
                        <Bolt className="h-4 w-4" />
                        <SendHorizontal className="h-4 w-4" />
                    </button>
                </div>
            </form>
        </div>
    );
}

export default ChatPanel;
