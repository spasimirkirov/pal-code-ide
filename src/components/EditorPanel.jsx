import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Code2, Plus, TerminalSquare, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

const INLINE_COMPLETION_URL = 'http://127.0.0.1:1234/v1/completions';
const runtime = window.palRuntime;

const TEXT_FILE_EXTENSIONS = new Set([
    '.txt', '.md', '.markdown', '.rst', '.adoc', '.org', '.log', '.cfg', '.ini', '.toml', '.yaml', '.yml', '.json', '.jsonc', '.xml', '.html', '.htm', '.csv', '.tsv', '.gitattributes', '.gitignore', '.editorconfig', '.npmrc', '.env', '.env.local', '.env.development', '.env.production', '.env.test', '.license', '.licence', '.readme', '.mdx',
]);

const TEXT_AUTOCOMPLETE_SYSTEM_PROMPT =
    'SYSTEM: You are a fast, low-latency sentence completer for an IDE\'s non-code files. Given the preceding context, provide a single concise completion (max 10 words) for the current word or phrase. Do NOT output code snippets or programming paradigms. Maintain a professional, documentation-oriented tone.';

const CODE_AUTOCOMPLETE_SYSTEM_PROMPT =
    'SYSTEM: You are a fast, low-latency code completer for an IDE. Continue the current code pattern concisely and avoid repeating existing text.';

const normalizeSuggestionPayload = (value, { maxWords = null } = {}) => {
    const text = String(value || '').replace(/\r/g, '').trim();
    if (!text) {
        return '';
    }

    const withoutFenceArtifacts = text.replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ''));
    const collapsedWhitespace = withoutFenceArtifacts.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    const lines = collapsedWhitespace.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
        return '';
    }

    const dedupedLines = [];
    for (const line of lines) {
        if (dedupedLines[dedupedLines.length - 1] !== line) {
            dedupedLines.push(line);
        }
    }

    let suggestion = dedupedLines.join('\n').trim();
    const repeatedBlockMatch = suggestion.match(/^(\S[\s\S]*?)\n\1(?:\n\1)+$/);
    if (repeatedBlockMatch) {
        suggestion = repeatedBlockMatch[1].trim();
    }

    if (maxWords) {
        suggestion = suggestion.split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ').trim();
    }

    return suggestion;
};

const getActiveFileTypeInfo = (filePath) => {
    const rawPath = String(filePath || '').trim();
    if (!rawPath) {
        return { extension: '', isTextLike: true };
    }

    const normalizedPath = rawPath.replace(/\\/g, '/');
    const fileName = normalizedPath.split('/').pop() || normalizedPath;
    const lowerName = fileName.toLowerCase();

    if (lowerName.startsWith('.') && !lowerName.slice(1).includes('.')) {
        return { extension: lowerName, isTextLike: true };
    }

    const lastDotIndex = lowerName.lastIndexOf('.');
    const extension = lastDotIndex >= 0 ? lowerName.slice(lastDotIndex) : '';
    if (!extension) {
        return { extension: '', isTextLike: true };
    }

    return {
        extension,
        isTextLike: TEXT_FILE_EXTENSIONS.has(extension),
    };
};

const buildAutocompletePrompt = ({ beforeCursor, afterCursor, isTextLike }) => {
    if (isTextLike) {
        return [
            TEXT_AUTOCOMPLETE_SYSTEM_PROMPT,
            'Complete the current text naturally and briefly.',
            `PREFIX:\n${beforeCursor}`,
            `SUFFIX:\n${afterCursor}`,
            'RESPONSE:',
        ].join('\n\n');
    }

    return `<|fim_prefix|>${beforeCursor}<|fim_suffix|>${afterCursor}<|fim_middle|>`;
};

const resolveAutocompleteModel = (settings, isTextLike) => {
    const codingModel = String(settings?.roleMappings?.coding || '').trim();
    const autocompleteModel = String(settings?.roleMappings?.autocomplete || '').trim();

    if (isTextLike) {
        return autocompleteModel || '';
    }

    return codingModel || autocompleteModel || '';
};

function EditorPanel({
    code,
    onChangeCode,
    activeFilePath = 'untitled.py',
    openTabs = [],
    activeTabId = '',
    onActivateTab,
    onCloseTab,
    onPinPreviewTab,
    onSaveActiveTab,
    onModelMetricsUpdate,
    terminalHeightRatio = 0.27,
    onTerminalHeightRatioChange,
    terminalVisible = true,
    onToggleTerminal,
    onTerminalStateChange,
}) {
    const terminalWrapRef = useRef(null);
    const terminalContainerMapRef = useRef({});
    const terminalInstanceMapRef = useRef({});
    const fitAddonMapRef = useRef({});
    const terminalCleanupMapRef = useRef({});
    const editorRef = useRef(null);
    const monacoRef = useRef(null);
    const inlineSuggestionRef = useRef({ text: '', lineNumber: 1, column: 1 });
    const inlineRequestCounterRef = useRef(0);
    const inlineTimerRef = useRef(null);
    const inlineDisposablesRef = useRef([]);
    const aiSettingsRef = useRef(null);
    const onSaveActiveTabRef = useRef(onSaveActiveTab);
    const terminalsRef = useRef([]);
    const terminalStatusByIdRef = useRef({});
    const [terminals, setTerminals] = useState([{ id: 'terminal-1', title: 'Terminal 1' }]);
    const [activeTerminalId, setActiveTerminalId] = useState('terminal-1');
    const [terminalHydrated, setTerminalHydrated] = useState(false);
    const activeTerminalIdRef = useRef('terminal-1');

    const reportTerminalState = () => {
        const activeId = activeTerminalIdRef.current;
        const statusMap = terminalStatusByIdRef.current || {};
        const runningCount = Object.values(statusMap).filter((status) => status === 'running').length;

        onTerminalStateChange?.({
            total: terminalsRef.current.length,
            running: runningCount,
            activeTerminalId: activeId,
            activeStatus: statusMap[activeId] || 'idle',
        });
    };

    const disposeInlineCompletions = () => {
        for (const item of inlineDisposablesRef.current) {
            item?.dispose?.();
        }
        inlineDisposablesRef.current = [];

        if (inlineTimerRef.current) {
            clearTimeout(inlineTimerRef.current);
            inlineTimerRef.current = null;
        }
    };

    const registerInlineCompletions = (editor, monaco) => {
        const triggerInlineRequest = () => {
            if (inlineTimerRef.current) {
                clearTimeout(inlineTimerRef.current);
            }

            inlineTimerRef.current = setTimeout(async () => {
                const model = editor.getModel();
                const position = editor.getPosition();

                if (!model || !position) {
                    return;
                }

                const wholeText = model.getValue();
                const offset = model.getOffsetAt(position);
                const beforeCursor = wholeText.slice(0, offset);
                const afterCursor = wholeText.slice(offset);
                const fileTypeInfo = getActiveFileTypeInfo(activeFilePath);
                const selectedModel = resolveAutocompleteModel(aiSettingsRef.current, fileTypeInfo.isTextLike);

                if (beforeCursor.trim().length < 3) {
                    inlineSuggestionRef.current = { text: '', lineNumber: position.lineNumber, column: position.column };
                    return;
                }

                const requestId = inlineRequestCounterRef.current + 1;
                inlineRequestCounterRef.current = requestId;

                const startedAt = performance.now();
                try {
                    const prompt = buildAutocompletePrompt({
                        beforeCursor,
                        afterCursor,
                        isTextLike: fileTypeInfo.isTextLike,
                    });

                    const requestBody = {
                        prompt,
                        max_tokens: fileTypeInfo.isTextLike ? 10 : 64,
                        temperature: fileTypeInfo.isTextLike ? 0.1 : 0.2,
                        stop: fileTypeInfo.isTextLike
                            ? ['\n\n', '```']
                            : ['<|fim_prefix|>', '<|fim_suffix|>', '<|fim_middle|>'],
                    };

                    if (selectedModel) {
                        requestBody.model = selectedModel;
                    }

                    const response = await fetch(INLINE_COMPLETION_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(requestBody),
                    });

                    if (!response.ok) {
                        return;
                    }

                    const payload = await response.json();
                    let suggestion = String(payload?.choices?.[0]?.text || payload?.choices?.[0]?.message?.content || '');
                    suggestion = normalizeSuggestionPayload(suggestion, {
                        maxWords: fileTypeInfo.isTextLike ? 10 : null,
                    });

                    if (inlineRequestCounterRef.current !== requestId) {
                        return;
                    }

                    if (!suggestion) {
                        inlineSuggestionRef.current = {
                            text: '',
                            lineNumber: position.lineNumber,
                            column: position.column,
                        };
                        return;
                    }

                    inlineSuggestionRef.current = {
                        text: suggestion,
                        lineNumber: position.lineNumber,
                        column: position.column,
                    };

                    const responseTokens = Math.max(1, Math.round(suggestion.length / 4));
                    const promptTokens = Math.max(1, Math.round((beforeCursor.length + afterCursor.length) / 4));
                    const elapsedSec = Math.max(0.08, (performance.now() - startedAt) / 1000);

                    onModelMetricsUpdate?.({
                        tokensPerSec: Number((responseTokens / elapsedSec).toFixed(1)),
                        contextUsed: promptTokens + responseTokens,
                        contextTotal: 32000,
                    });

                    editor.trigger('keyboard', 'editor.action.inlineSuggest.trigger', {});
                } catch {
                    // Ignore transient completion endpoint failures.
                }
            }, 400);
        };

        const providerFactory = (languageId) =>
            monaco.languages.registerInlineCompletionsProvider(languageId, {
                provideInlineCompletions(model, position) {
                    if (model !== editor.getModel()) {
                        return { items: [] };
                    }

                    const suggestion = inlineSuggestionRef.current;
                    const samePosition =
                        suggestion.lineNumber === position.lineNumber && suggestion.column === position.column;

                    if (!samePosition || !suggestion.text) {
                        return { items: [] };
                    }

                    return {
                        items: [
                            {
                                insertText: suggestion.text,
                                range: new monaco.Range(
                                    position.lineNumber,
                                    position.column,
                                    position.lineNumber,
                                    position.column,
                                ),
                            },
                        ],
                    };
                },
                freeInlineCompletions() { },
            });

        inlineDisposablesRef.current.push(providerFactory('python'));
        inlineDisposablesRef.current.push(providerFactory('javascript'));
        inlineDisposablesRef.current.push(
            editor.onDidChangeModelContent(() => {
                triggerInlineRequest();
            }),
        );
        inlineDisposablesRef.current.push(
            editor.onDidChangeCursorPosition(() => {
                triggerInlineRequest();
            }),
        );

        editor.updateOptions({
            inlineSuggest: {
                enabled: true,
            },
        });

        editor.addAction({
            id: 'pal-inline-tab-accept',
            label: 'Accept Ghost Text',
            keybindings: [monaco.KeyCode.Tab],
            precondition: 'inlineSuggestionVisible',
            run: () => {
                editor.trigger('keyboard', 'editor.action.inlineSuggest.commit', {});
            },
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
            await onSaveActiveTabRef.current?.();
        });
    };

    useEffect(() => {
        onSaveActiveTabRef.current = onSaveActiveTab;
    }, [onSaveActiveTab]);

    useEffect(() => {
        return () => {
            disposeInlineCompletions();
        };
    }, []);

    useEffect(() => {
        activeTerminalIdRef.current = activeTerminalId;
        reportTerminalState();
    }, [activeTerminalId]);

    useEffect(() => {
        terminalsRef.current = terminals;
        reportTerminalState();
    }, [terminals]);

    useEffect(() => {
        let mounted = true;

        const hydrateAutocompleteSettings = async () => {
            try {
                const settings = await runtime?.getAiAssistantSettings?.();
                if (mounted) {
                    aiSettingsRef.current = settings || null;
                }
            } catch {
                if (mounted) {
                    aiSettingsRef.current = null;
                }
            }
        };

        void hydrateAutocompleteSettings();
        return () => {
            mounted = false;
        };
    }, []);

    const fitAndSyncTerminal = (terminalId) => {
        const fitAddon = fitAddonMapRef.current[terminalId];
        const terminal = terminalInstanceMapRef.current[terminalId];
        const container = terminalContainerMapRef.current[terminalId];
        if (!fitAddon || !terminal || !container) {
            return;
        }

        if (!container.clientWidth || !container.clientHeight) {
            return;
        }

        try {
            fitAddon.fit();
        } catch {
            return;
        }

        void runtime?.terminalResize?.({
            terminalId,
            cols: terminal.cols,
            rows: terminal.rows,
        });
    };

    const destroyTerminalInstance = (terminalId) => {
        terminalCleanupMapRef.current[terminalId]?.();
        delete terminalCleanupMapRef.current[terminalId];
        delete fitAddonMapRef.current[terminalId];
        delete terminalInstanceMapRef.current[terminalId];
    };

    const mountTerminalInstance = (terminalId) => {
        const container = terminalContainerMapRef.current[terminalId];
        if (!container || terminalInstanceMapRef.current[terminalId]) {
            return;
        }

        const fitAddon = new FitAddon();
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            theme: {
                background: '#050811',
                foreground: '#c7d0e0',
                cursor: '#2bd1ff',
                black: '#0c1020',
                red: '#ff6b7a',
                green: '#91f7a3',
                yellow: '#ffd166',
                blue: '#69b7ff',
                magenta: '#eaa8ff',
                cyan: '#7ff8ff',
                white: '#d6deeb',
                brightBlack: '#4b5568',
                brightRed: '#ff8a98',
                brightGreen: '#bbf7d0',
                brightYellow: '#ffe4a3',
                brightBlue: '#9ac8ff',
                brightMagenta: '#f4c8ff',
                brightCyan: '#a9fbff',
                brightWhite: '#f8fafc',
            },
        });

        term.loadAddon(fitAddon);
        term.attachCustomKeyEventHandler((event) => {
            if (event.type !== 'keydown') {
                return true;
            }

            if (event.ctrlKey && event.code === 'KeyC') {
                if (term.hasSelection()) {
                    void navigator.clipboard.writeText(term.getSelection());
                    term.clearSelection();
                    return false;
                }

                void runtime?.terminalSendInput?.({ terminalId, command: '\u0003' });
                return false;
            }

            if (event.ctrlKey && event.code === 'KeyV') {
                void navigator.clipboard.readText().then((text) => {
                    if (text) {
                        void runtime?.terminalSendInput?.({ terminalId, command: text });
                    }
                });
                return false;
            }

            return true;
        });

        term.open(container);
        terminalInstanceMapRef.current[terminalId] = term;
        fitAddonMapRef.current[terminalId] = fitAddon;

        const handleTerminalPaste = async (event) => {
            if (event.button !== 2) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    void runtime?.terminalSendInput?.({ terminalId, command: text });
                }
            } catch {
                // Ignore clipboard failures during paste.
            }
        };

        const handleContextMenu = (event) => {
            event.preventDefault();
        };

        const dataSubscription = term.onData((input) => {
            void runtime?.terminalSendInput?.({ terminalId, command: input });
        });

        container.addEventListener('mousedown', handleTerminalPaste);
        container.addEventListener('contextmenu', handleContextMenu);

        terminalCleanupMapRef.current[terminalId] = () => {
            dataSubscription.dispose();
            container.removeEventListener('mousedown', handleTerminalPaste);
            container.removeEventListener('contextmenu', handleContextMenu);
            term.dispose();
        };

        void runtime?.terminalCreate?.({
            terminalId,
            cols: term.cols,
            rows: term.rows,
        });
        terminalStatusByIdRef.current[terminalId] = 'starting';
        reportTerminalState();
        requestAnimationFrame(() => fitAndSyncTerminal(terminalId));
    };

    useEffect(() => {
        let mounted = true;

        const hydrateTerminalSessions = async () => {
            try {
                const response = await runtime?.terminalList?.();
                const sessions = Array.isArray(response?.terminals) ? response.terminals : [];
                if (!mounted) {
                    return;
                }

                if (sessions.length > 0) {
                    const hydratedTabs = sessions.map((session, index) => ({
                        id: String(session?.terminalId || `terminal-${index + 1}`),
                        title: `Terminal ${index + 1}`,
                    }));
                    const statusMap = {};
                    for (const tab of hydratedTabs) {
                        statusMap[tab.id] = 'running';
                    }
                    terminalStatusByIdRef.current = statusMap;
                    setTerminals(hydratedTabs);
                    setActiveTerminalId((current) => (hydratedTabs.some((tab) => tab.id === current) ? current : hydratedTabs[0].id));
                } else {
                    terminalStatusByIdRef.current = { 'terminal-1': 'idle' };
                }
            } catch {
                if (mounted) {
                    terminalStatusByIdRef.current = { 'terminal-1': 'idle' };
                }
            } finally {
                if (mounted) {
                    setTerminalHydrated(true);
                    reportTerminalState();
                }
            }
        };

        void hydrateTerminalSessions();

        const outputUnsubscribe = runtime?.onTerminalOutput?.((payload) => {
            const terminalId = typeof payload === 'string'
                ? activeTerminalIdRef.current
                : String(payload?.terminalId || activeTerminalIdRef.current);
            const data = typeof payload === 'string' ? payload : String(payload?.data || '');

            if (!terminalInstanceMapRef.current[terminalId]) {
                setTerminals((current) => {
                    if (current.some((item) => item.id === terminalId)) {
                        return current;
                    }

                    const nextIndex = current.length + 1;
                    return [...current, { id: terminalId, title: `Terminal ${nextIndex}` }];
                });
                terminalStatusByIdRef.current[terminalId] = terminalStatusByIdRef.current[terminalId] || 'running';
                reportTerminalState();
                return;
            }

            terminalInstanceMapRef.current[terminalId].write(data);
        });

        const statusUnsubscribe = runtime?.onTerminalStatus?.((payload) => {
            const terminalId = String(payload?.terminalId || activeTerminalIdRef.current);
            const status = String(payload?.status || 'unknown');
            if (!terminalsRef.current.some((item) => item.id === terminalId)) {
                setTerminals((current) => {
                    if (current.some((item) => item.id === terminalId)) {
                        return current;
                    }
                    const nextIndex = current.length + 1;
                    return [...current, { id: terminalId, title: `Terminal ${nextIndex}` }];
                });
            }

            if (status === 'created') {
                terminalStatusByIdRef.current[terminalId] = 'running';
            } else if (status === 'exited') {
                terminalStatusByIdRef.current[terminalId] = payload?.userClosed ? 'closed' : 'idle';
            } else if (status === 'closed') {
                terminalStatusByIdRef.current[terminalId] = 'closed';
            }
            reportTerminalState();

            const terminal = terminalInstanceMapRef.current[terminalId];
            if (!terminal) {
                return;
            }

            if (status === 'created') {
                terminal.write(`\r\n[session ready] ${payload?.cwd || ''}\r\n`);
                return;
            }

            if (status === 'exited' && !payload?.userClosed) {
                terminal.write(`\r\n[session ended] code=${payload?.exitCode ?? 0} signal=${payload?.signal ?? 'none'}\r\n`);
                return;
            }

            if (status === 'closed') {
                terminal.write('\r\n[session closed]\r\n');
            }
        });

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => fitAndSyncTerminal(activeTerminalIdRef.current));
        });

        if (terminalWrapRef.current) {
            resizeObserver.observe(terminalWrapRef.current);
        }

        return () => {
            mounted = false;
            resizeObserver.disconnect();
            if (outputUnsubscribe) {
                outputUnsubscribe();
            }
            if (statusUnsubscribe) {
                statusUnsubscribe();
            }

            for (const terminalId of Object.keys(terminalCleanupMapRef.current)) {
                destroyTerminalInstance(terminalId);
            }
        };
    }, []);

    useEffect(() => {
        if (!terminalHydrated) {
            return;
        }
        requestAnimationFrame(() => mountTerminalInstance(activeTerminalId));
        requestAnimationFrame(() => fitAndSyncTerminal(activeTerminalId));
    }, [activeTerminalId, terminals.length, terminalHydrated]);

    const createTerminal = () => {
        const nextIndex = terminals.length + 1;
        const terminalId = `terminal-${Date.now()}`;
        terminalStatusByIdRef.current[terminalId] = 'starting';
        setTerminals((current) => [...current, { id: terminalId, title: `Terminal ${nextIndex}` }]);
        setActiveTerminalId(terminalId);
        reportTerminalState();
    };

    const closeTerminal = (terminalId) => {
        if (terminals.length === 1) {
            return;
        }

        destroyTerminalInstance(terminalId);
        void runtime?.terminalClose?.({ terminalId });
        delete terminalStatusByIdRef.current[terminalId];

        setTerminals((current) => {
            const next = current.filter((item) => item.id !== terminalId);
            if (activeTerminalId === terminalId && next.length) {
                setActiveTerminalId(next[next.length - 1].id);
            }
            return next;
        });
        reportTerminalState();
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[#0f1319]">
            <div className="flex h-9 items-center border-b border-slate-800 bg-slate-950/70 px-1">
                {openTabs.length ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                        {openTabs.map((tab) => {
                            const active = tab.id === activeTabId;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => onActivateTab?.(tab.id)}
                                    className={`group inline-flex h-7 max-w-[280px] items-center gap-2 rounded-md border px-2 text-xs ${active
                                        ? 'border-cyan-300/40 bg-cyan-300/12 text-cyan-100'
                                        : 'border-slate-700/70 bg-slate-900/70 text-slate-300 hover:text-slate-100'
                                        }`}
                                    title={tab.path}
                                    onDoubleClick={() => {
                                        if (tab.isPreview) {
                                            onPinPreviewTab?.(tab.id);
                                        }
                                    }}
                                >
                                    <Code2 className="h-3.5 w-3.5 shrink-0" />
                                    <span className={`truncate ${tab.isPreview ? 'italic text-slate-200' : ''}`}>
                                        {tab.title}
                                    </span>
                                    {tab.isDirty && (
                                        <span className="h-2 w-2 rounded-full bg-amber-300" title="Unsaved changes" />
                                    )}
                                    {tab.isPreview && (
                                        <span className="rounded border border-slate-600/80 px-1 py-0 text-[10px] uppercase tracking-[0.08em] text-slate-400">
                                            Preview
                                        </span>
                                    )}
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onCloseTab?.(tab.id);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onCloseTab?.(tab.id);
                                            }
                                        }}
                                        className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                                    >
                                        <X className="h-3 w-3" />
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                        <Code2 className="h-4 w-4" />
                        No open editors
                    </div>
                )}

                <div className="ml-2 max-w-[35%] truncate pr-2 text-[11px] text-slate-500" title={activeFilePath}>
                    {activeFilePath || 'Welcome'}
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-hidden border-b border-edge">
                    {openTabs.length ? (
                        <Editor
                            height="100%"
                            defaultLanguage="python"
                            theme="vs-dark"
                            value={code}
                            onMount={(editor, monaco) => {
                                editorRef.current = editor;
                                monacoRef.current = monaco;
                                disposeInlineCompletions();
                                registerInlineCompletions(editor, monaco);
                            }}
                            onChange={(value) => onChangeCode(value ?? '')}
                            options={{
                                minimap: { enabled: false },
                                smoothScrolling: true,
                                fontSize: 14,
                                tabSize: 2,
                                readOnly: false,
                                roundedSelection: true,
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                padding: { top: 16 },
                            }}
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center bg-[#0f1319] p-6">
                            <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-cyan-100">Welcome to PAL IDE</h3>
                                <p className="mb-2 text-sm text-slate-300">Select a file from Explorer to preview it.</p>
                                <p className="text-sm text-slate-400">Double-click a file to open it and keep it as a pinned tab.</p>
                            </div>
                        </div>
                    )}
                </div>

                {terminalVisible && (
                    <>
                        <div
                            onMouseDown={(event) => {
                                event.preventDefault();

                                const container = terminalWrapRef.current?.parentElement;
                                if (!container) {
                                    return;
                                }

                                const totalHeight = container.clientHeight || 1;
                                const startY = event.clientY;
                                const startRatio = terminalHeightRatio;

                                const onMove = (moveEvent) => {
                                    const deltaRatio = (moveEvent.clientY - startY) / totalHeight;
                                    const nextRatio = Math.max(0.16, Math.min(0.45, startRatio - deltaRatio));
                                    onTerminalHeightRatioChange?.(nextRatio);
                                };

                                const onUp = () => {
                                    window.removeEventListener('mousemove', onMove);
                                    window.removeEventListener('mouseup', onUp);
                                };

                                window.addEventListener('mousemove', onMove);
                                window.addEventListener('mouseup', onUp);
                            }}
                            className="h-1 cursor-row-resize bg-transparent transition hover:bg-cyan-300/25"
                            title="Resize terminal"
                        />

                        <div ref={terminalWrapRef} className="min-h-[170px] bg-[#0a0f16]" style={{ height: `${Math.round(terminalHeightRatio * 100)}%` }}>
                            <div className="flex h-8 items-center justify-between gap-2 border-b border-slate-800 px-2 text-[11px] text-slate-400">
                                <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                                    <span className="inline-flex items-center gap-1 px-2 uppercase tracking-[0.08em] text-cyan-300">
                                        <TerminalSquare className="h-3.5 w-3.5" />
                                        Terminal
                                    </span>
                                    {terminals.map((terminal) => {
                                        const active = terminal.id === activeTerminalId;
                                        return (
                                            <button
                                                key={terminal.id}
                                                type="button"
                                                onClick={() => setActiveTerminalId(terminal.id)}
                                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${active
                                                    ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100'
                                                    : 'border-slate-700/80 bg-slate-900/70 text-slate-300'
                                                    }`}
                                            >
                                                {terminal.title}
                                                {terminals.length > 1 && (
                                                    <span
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            closeTerminal(terminal.id);
                                                        }}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter' || event.key === ' ') {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                closeTerminal(terminal.id);
                                                            }
                                                        }}
                                                        className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                                <button
                                    type="button"
                                    onClick={createTerminal}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-900/70 px-2 py-0.5 text-[11px] text-slate-300 hover:text-cyan-100"
                                    title="New terminal"
                                >
                                    <Plus className="h-3 w-3" /> New
                                </button>
                            </div>
                            <div className="h-[calc(100%-32px)] w-full px-1 py-1">
                                {terminals.map((terminal) => (
                                    <div
                                        key={terminal.id}
                                        ref={(element) => {
                                            if (element) {
                                                terminalContainerMapRef.current[terminal.id] = element;
                                            } else {
                                                delete terminalContainerMapRef.current[terminal.id];
                                            }
                                        }}
                                        className={`h-full w-full ${terminal.id === activeTerminalId ? 'block' : 'hidden'}`}
                                    />
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default EditorPanel;
