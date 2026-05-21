import React, { useMemo, useRef, useState } from 'react';
import { Bot, Bolt, SendHorizontal, Sparkles, User } from 'lucide-react';

const CHAT_API_URL = 'http://127.0.0.1:8008/api/chat';
const runtime = window.palRuntime;

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
    const viewportRef = useRef(null);

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
            let streamedText = '';
            const response = await fetch(CHAT_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: effectivePrompt,
                    stream: true,
                    workspace_path: workspaceRoot || undefined,
                }),
            });

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            if (!response.body) {
                const data = await response.json();
                const nonStreamed = data?.response ?? data?.text ?? 'No response body was returned.';
                streamedText = String(nonStreamed || '');
                appendChunk(assistantId, nonStreamed);
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
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                if (chunk) {
                    streamedText += chunk;
                    appendChunk(assistantId, chunk);
                    setTimeout(autoScroll, 0);
                }
            }

            finishAssistant(assistantId);

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
                        className={`rounded-2xl border p-3 shadow-sm ${isUser
                            ? 'ml-8 border-cyan-400/30 bg-cyan-400/10'
                            : 'mr-8 border-slate-700/70 bg-slate-900/80'
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
        <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-edge bg-panel/85 shadow-glow">
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
                <div>
                    <h2 className="text-sm font-semibold tracking-[0.12em] text-cyan-100">Agent Chat</h2>
                    <p className="text-xs text-slate-400">Streaming intelligence channel</p>
                </div>
                <div className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-200">
                    local:8008
                </div>
            </div>

            <div ref={viewportRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                {renderedMessages}
            </div>

            <form onSubmit={sendPrompt} className="border-t border-edge bg-panelSoft/70 p-3">
                <div className="flex items-end gap-2">
                    <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        rows={2}
                        placeholder="Ask PAL to generate, refactor, or patch code... Use /web <query> for search context."
                        className="max-h-40 min-h-[52px] flex-1 resize-y rounded-xl border border-slate-700/80 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/45"
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
