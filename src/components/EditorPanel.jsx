import React, { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Code2, TerminalSquare } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

const INLINE_COMPLETION_URL = 'http://127.0.0.1:1234/v1/completions';

function EditorPanel({ code, onChangeCode, activeFilePath = 'untitled.py', onModelMetricsUpdate }) {
    const terminalContainerRef = useRef(null);
    const terminalRef = useRef(null);
    const fitAddonRef = useRef(null);
    const editorRef = useRef(null);
    const monacoRef = useRef(null);
    const inlineSuggestionRef = useRef({ text: '', lineNumber: 1, column: 1 });
    const inlineRequestCounterRef = useRef(0);
    const inlineTimerRef = useRef(null);
    const inlineDisposablesRef = useRef([]);

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

                if (beforeCursor.trim().length < 3) {
                    inlineSuggestionRef.current = { text: '', lineNumber: position.lineNumber, column: position.column };
                    return;
                }

                const requestId = inlineRequestCounterRef.current + 1;
                inlineRequestCounterRef.current = requestId;

                const startedAt = performance.now();
                try {
                    const prompt = `<|fim_prefix|>${beforeCursor}<|fim_suffix|>${afterCursor}<|fim_middle|>`;
                    const response = await fetch(INLINE_COMPLETION_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            prompt,
                            max_tokens: 64,
                            temperature: 0.2,
                            stop: ['<|fim_prefix|>', '<|fim_suffix|>', '<|fim_middle|>'],
                        }),
                    });

                    if (!response.ok) {
                        return;
                    }

                    const payload = await response.json();
                    let suggestion = String(payload?.choices?.[0]?.text || '');
                    suggestion = suggestion
                        .replace(/<\|fim_(prefix|suffix|middle)\|>/g, '')
                        .replace(/\r/g, '');

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
    };

    useEffect(() => {
        return () => {
            disposeInlineCompletions();
        };
    }, []);

    useEffect(() => {
        if (!terminalContainerRef.current || terminalRef.current) {
            return;
        }

        let disposed = false;

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

        const safeFit = () => {
            if (disposed || !terminalContainerRef.current || !terminalRef.current || !fitAddonRef.current) {
                return;
            }

            const { clientWidth, clientHeight } = terminalContainerRef.current;
            if (!clientWidth || !clientHeight) {
                return;
            }

            try {
                fitAddonRef.current.fit();
            } catch {
                // Ignore intermittent fit errors during rapid mount/unmount/layout changes.
            }
        };

        term.loadAddon(fitAddon);
        terminalRef.current = term;
        fitAddonRef.current = fitAddon;

        term.open(terminalContainerRef.current);
        requestAnimationFrame(safeFit);

        term.writeln('PAL runtime terminal initialized.');
        term.writeln('Tip: wire this pane to your PTY bridge in preload/main process.');
        term.prompt = () => term.write('\r\n$ ');
        term.prompt();

        const dataSubscription = term.onData((input) => {
            if (input === '\r') {
                term.prompt();
            } else if (input === '\u007F') {
                term.write('\b \b');
            } else {
                term.write(input);
            }
        });

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(safeFit);
        });

        resizeObserver.observe(terminalContainerRef.current);

        return () => {
            disposed = true;
            resizeObserver.disconnect();
            dataSubscription.dispose();
            term.dispose();
            terminalRef.current = null;
            fitAddonRef.current = null;
        };
    }, []);

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-edge bg-panel/85 shadow-glow">
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
                <div className="flex items-center gap-2 text-cyan-100">
                    <Code2 className="h-4 w-4" />
                    <h2 className="text-sm font-semibold tracking-[0.12em]">Workspace Editor</h2>
                </div>
                <div className="max-w-[65%] truncate text-xs text-slate-400" title={activeFilePath}>
                    {activeFilePath}
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-hidden border-b border-edge">
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
                            roundedSelection: true,
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            padding: { top: 16 },
                        }}
                    />
                </div>

                <div className="h-[30%] min-h-[170px] bg-[#050811]">
                    <div className="flex h-8 items-center gap-2 border-b border-edge/70 px-3 text-xs uppercase tracking-[0.1em] text-slate-400">
                        <TerminalSquare className="h-3.5 w-3.5 text-cyan-300" />
                        Terminal
                    </div>
                    <div ref={terminalContainerRef} className="h-[calc(100%-32px)] w-full px-2 py-1" />
                </div>
            </div>
        </div>
    );
}

export default EditorPanel;
