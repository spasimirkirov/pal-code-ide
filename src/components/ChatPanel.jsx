import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CHAT_SESSION_ID, defaultAiSettings } from '../config/aiConfig';
import ChatComposer from './chat/ChatComposer';
import ChatHeaderBar from './chat/ChatHeaderBar';
import ChatMessageItem from './chat/ChatMessageItem';
import { shouldAutoApproveAction } from '../utils/aiHelpers';

const runtime = window.palRuntime;
const electronAPI = window.electronAPI;
const AIM = window.aiRuntime;
const DEFAULT_MESSAGES = [
    { id: 'system-1', role: 'assistant', text: 'Agent online. Ask for architecture, refactors, or full-file code updates.', status: 'done' },
];

const updateMessageById = (messages, id, updater) =>
    messages.map((msg) => (msg.id === id ? (typeof updater === 'function' ? updater(msg) : updater) : msg));

const hashText = (value) => {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

const ensureActionIds = (actions, scope = 'action') => {
    const list = Array.isArray(actions) ? actions : [];
    return list.map((action, index) => {
        const actionId = String(action?.actionId || '').trim();
        if (actionId) {
            return action;
        }

        const signature = hashText(JSON.stringify({ ...action, actionId: undefined }));
        return {
            ...action,
            actionId: `${scope}:${index}:${signature}`,
        };
    });
};

const compactProgressLine = (value) => {
    const normalized = String(value || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^tokens:\s+/i.test(line))
        .filter((line) => line !== '>');

    if (!normalized.length) {
        return '';
    }

    const line = normalized[normalized.length - 1].replace(/\s+/g, ' ').trim();
    return line.length > 120 ? `${line.slice(0, 117)}...` : line;
};

const summarizeActions = (actions) => {
    const list = Array.isArray(actions) ? actions : [];
    if (!list.length) {
        return '';
    }

    const topItems = list.slice(0, 4).map((action) => {
        const type = String(action?.type || 'action').replace(/-/g, ' ');
        const path = String(action?.path || '').trim();
        if (path) {
            return `${type}: ${path}`;
        }

        const summary = String(action?.summary || '').trim();
        return summary || type;
    });

    const extra = list.length - topItems.length;
    const details = topItems.map((item) => `- ${item}`).join('\n');
    const extraLine = extra > 0 ? `\n- +${extra} more action(s)` : '';
    return `Done. ${list.length} action(s) prepared.\n${details}${extraLine}`;
};

const summarizeFinalResponse = (payloadText, actions) => {
    const actionSummary = summarizeActions(actions);
    if (actionSummary) {
        return actionSummary;
    }

    const compact = String(payloadText || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join('\n');

    return compact || 'Done.';
};

function ChatPanel({ onApplyCode, workspaceRoot, onModelMetricsUpdate, autoApprovalMode, onAutoApprovalModeChange, settingsRefreshKey, focusRequestId, ideContext }) {
    const [messages, setMessages] = useState(DEFAULT_MESSAGES);
    const [prompt, setPrompt] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [aiSettings, setAiSettings] = useState(defaultAiSettings);
    const [workspaceActionState, setWorkspaceActionState] = useState({});
    const [appliedActionIds, setAppliedActionIds] = useState([]);
    const [deniedActionIds, setDeniedActionIds] = useState([]);
    const viewportRef = useRef(null);
    const sessionLoadedRef = useRef(false);
    const sessionHydratingRef = useRef(false);
    const activeTraceIdRef = useRef('');
    const activeCleanupRef = useRef(null);
    const composerRef = useRef(null);
    const appliedRef = useRef(appliedActionIds);
    const deniedRef = useRef(deniedActionIds);
    const messagesRef = useRef(messages);

    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => { appliedRef.current = appliedActionIds; }, [appliedActionIds]);
    useEffect(() => { deniedRef.current = deniedActionIds; }, [deniedActionIds]);

    const autoScroll = () => {
        if (viewportRef.current) {
            viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        }
    };

    // ── Session persistence ───────────────────────────────────────────

    const persistSession = useCallback((nextMessages, nextApplied) => {
        if (!sessionLoadedRef.current || sessionHydratingRef.current) return;
        void electronAPI?.saveChatSession?.(DEFAULT_CHAT_SESSION_ID, { messages: nextMessages, appliedActionIds: nextApplied });
    }, []);

    useEffect(() => { persistSession(messages, appliedActionIds); }, [messages, appliedActionIds, persistSession]);

    useEffect(() => {
        let mounted = true;
        const hydrate = async () => {
            sessionHydratingRef.current = true;
            try {
                const restored = await electronAPI?.loadChatSession?.(DEFAULT_CHAT_SESSION_ID);
                if (!mounted) return;
                sessionLoadedRef.current = true;
                setMessages(Array.isArray(restored?.messages) ? restored.messages : DEFAULT_MESSAGES);
                setAppliedActionIds(Array.isArray(restored?.appliedActionIds) ? restored.appliedActionIds : []);
            } catch {
                if (mounted) { sessionLoadedRef.current = true; setMessages(DEFAULT_MESSAGES); setAppliedActionIds([]); }
            } finally { sessionHydratingRef.current = false; }
        };
        void hydrate();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        let mounted = true;
        const loadSettings = async () => {
            try {
                const s = await runtime?.getAiAssistantSettings?.();
                if (mounted && s) setAiSettings(s);
            } catch { /* */ }
        };
        void loadSettings();
        return () => { mounted = false; };
    }, [settingsRefreshKey]);

    useEffect(() => { autoScroll(); }, [messages]);

    useEffect(() => {
        if (focusRequestId === undefined || focusRequestId === null) {
            return;
        }

        const focusComposer = () => {
            window.focus?.();
            composerRef.current?.focus?.();
        };

        const timer = window.setTimeout(focusComposer, 0);
        const retryTimer = window.setTimeout(focusComposer, 60);

        return () => {
            window.clearTimeout(timer);
            window.clearTimeout(retryTimer);
        };
    }, [focusRequestId]);

    const executeWorkspaceActionDirect = useCallback(async (action) => {
        const actionType = String(action?.type || '').replace(/_/g, '-').trim().toLowerCase();
        const actionPath = String(action?.path || '').trim();

        if (!actionType) {
            return { ok: false, error: 'Missing action type.' };
        }

        if (actionType === 'patch-search-replace') {
            if (!actionPath || actionPath === 'unknown') {
                return { ok: false, error: 'Patch action is missing a valid file path.' };
            }

            const patches = Array.isArray(action?.patches) ? action.patches : [];
            const blocks = patches
                .map((patch) => ({
                    search: String(patch?.search ?? patch?.find ?? ''),
                    replace: String(patch?.replace ?? ''),
                }))
                .filter((block) => block.search);

            if (!blocks.length) {
                return { ok: false, error: 'Patch action does not include valid search/replace blocks.' };
            }

            return await window.projectRuntime?.patchSearchReplace?.({ path: actionPath, blocks })
                || { ok: false, error: 'Patch service is unavailable.' };
        }

        if (actionType === 'patch-file') {
            return await runtime?.workspacePatchFile?.({ path: actionPath, patches: action?.patches, backup: true })
                || { ok: false, error: 'Workspace patch service is unavailable.' };
        }

        if (actionType === 'write-file') {
            return await runtime?.workspaceWriteFile?.({ path: actionPath, content: String(action?.content || ''), backup: true })
                || { ok: false, error: 'Workspace write service is unavailable.' };
        }

        if (actionType === 'delete-file') {
            return await runtime?.workspaceDeleteFile?.({ path: actionPath })
                || { ok: false, error: 'Workspace delete service is unavailable.' };
        }

        if (actionType === 'create-folder') {
            const normalizedPath = actionPath.replace(/\\/g, '/').replace(/\/+$/, '');
            const segments = normalizedPath.split('/').filter(Boolean);
            const name = segments.pop() || '';
            const parentPath = segments.join('/') || '.';

            if (!name) {
                return { ok: false, error: 'Folder action is missing target name.' };
            }

            return await runtime?.workspaceCreatePath?.({
                parentPath,
                name,
                type: 'folder',
            }) || { ok: false, error: 'Workspace create service is unavailable.' };
        }

        if (actionType === 'terminal-command') {
            return await runtime?.terminalExecute?.({
                command: String(action?.command || ''),
                shell: String(action?.shell || 'powershell'),
                timeoutMs: Number(action?.timeoutMs || 120000),
            }) || { ok: false, error: 'Terminal execution service is unavailable.' };
        }

        if (actionType === 'web-search') {
            return await runtime?.duckduckgoSearch?.({
                query: String(action?.query || ''),
                maxResults: Number(action?.maxResults || 6),
            }) || { ok: false, error: 'Web search service is unavailable.' };
        }

        return { ok: false, error: `Unsupported action type: ${actionType}` };
    }, []);

    // ── Send prompt ───────────────────────────────────────────────────

    const sendPrompt = async (event) => {
        event.preventDefault();
        const trimmed = prompt.trim();
        if (!trimmed || isSending) return;

        const freshSettings = await runtime?.getAiAssistantSettings?.() || aiSettings;
        if (freshSettings) setAiSettings(freshSettings);

        const assistantId = `assistant-${Date.now()}`;
        const userId = `user-${Date.now()}`;

        setIsSending(true);
        setPrompt('');
        activeTraceIdRef.current = assistantId;

        // Add user message + placeholder assistant message
        setMessages((current) => [
            ...current,
            { id: userId, role: 'user', text: trimmed, status: 'done' },
            {
                id: assistantId,
                role: 'assistant',
                text: '',
                thinking: '',
                activity: 'Planning steps...',
                executionSteps: [],
                status: 'streaming',
            },
        ]);

        // Per-session event subscriptions
        const unsubs = [];
        let actionsDuringStream = [];
        let accumulatedText = '';

        const onChunk = (payload) => {
            if (payload.traceId !== assistantId) return;
            accumulatedText += payload.text;
            const activity = compactProgressLine(payload.text);
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg,
                activity: activity || msg.activity || 'Working...',
            })));
        };

        const onThinking = (payload) => {
            if (payload.traceId !== assistantId) return;
            const activity = compactProgressLine(payload.text);
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg,
                activity: activity || msg.activity || 'Thinking...',
            })));
        };

        const onStreamText = (payload) => {
            if (payload.traceId !== assistantId) return;
            accumulatedText = payload.text;
            const activity = compactProgressLine(payload.text);
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg,
                activity: activity || msg.activity || 'Working...',
            })));
        };

        const onNativeAction = (payload) => {
            if (payload.traceId !== assistantId) return;
            const [normalizedAction] = ensureActionIds([payload.action], assistantId);
            actionsDuringStream.push(normalizedAction);
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg, workspaceActions: [...(msg.workspaceActions || []), normalizedAction],
            })));
        };

        const onActionPending = (payload) => {
            if (payload.traceId !== assistantId) return;
            const actionId = payload.action?.actionId;
            if (actionId) {
                setWorkspaceActionState((current) => ({
                    ...current,
                    [actionId]: { ...(current[actionId] || {}), status: 'awaiting', phase: 'awaiting_approval' },
                }));
            }
        };

        const onActionResult = (payload) => {
            if (payload.traceId !== assistantId) return;
            const { actionId, result } = payload;
            if (actionId) {
                setWorkspaceActionState((current) => ({
                    ...current,
                    [actionId]: {
                        ...(current[actionId] || {}),
                        status: result?.ok ? 'success' : 'error',
                        phase: result?.ok ? 'succeeded' : 'failed',
                        detail: result?.ok ? '' : String(result?.error || ''),
                    },
                }));
                if (result?.ok) {
                    setAppliedActionIds((current) => (current.includes(actionId) ? current : [...current, actionId]));
                }
            }
        };

        const onDone = (payload) => {
            if (payload.traceId !== assistantId) return;
            cleanup();
            const finalActions = payload.nativeActions?.length
                ? payload.nativeActions
                : payload.actions?.length
                    ? payload.actions
                    : null;
            const normalizedActions = ensureActionIds(finalActions || [], assistantId);
            const summaryText = summarizeFinalResponse(payload.text || accumulatedText, normalizedActions);
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg,
                text: summaryText,
                activity: '',
                status: 'done',
                workspaceActions: normalizedActions.length ? normalizedActions : msg.workspaceActions,
            })));
            setIsSending(false);
            activeTraceIdRef.current = '';
            setTimeout(autoScroll, 0);
        };

        const onError = (payload) => {
            if (payload.traceId !== assistantId) return;
            cleanup();
            const rawError = String(payload.error || '');
            const isModelError = /no model/i.test(rawError);
            const isTemplateMismatch = String(payload.errorCode || '') === 'template-mismatch'
                || /No user query found in messages/i.test(rawError)
                || /jinja template/i.test(rawError)
                || /prompt template/i.test(rawError);
            const isOverflow = /stream size limit/i.test(rawError);
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg,
                text: isOverflow
                    ? 'Agent output was too verbose for live streaming. Please retry in concise mode if no action cards are shown.'
                    : isTemplateMismatch
                    ? 'This model template in LM Studio is not compatible with the agent flow. Open LM Studio -> My Models -> Prompt Template and switch to a fixed template or the lmstudio-community variant, then retry.'
                    : isModelError
                    ? `Backend unavailable: ${payload.error}\n\nFix:\n1) Open AI Assistant -> LM Studio.\n2) Load/select a model and retry.`
                    : `Backend unavailable: ${payload.error}`,
                activity: '',
                status: 'done',
            })));
            setIsSending(false);
            activeTraceIdRef.current = '';
            setTimeout(autoScroll, 0);
        };

        const cleanup = () => {
            unsubs.forEach((u) => { try { u(); } catch { /* */ } });
            unsubs.length = 0;
            activeCleanupRef.current = null;
        };

        activeCleanupRef.current = cleanup;

        unsubs.push(
            AIM?.onStreamChunk?.(onChunk) || (() => {}),
            AIM?.onThinkingChunk?.(onThinking) || (() => {}),
            AIM?.onStreamText?.(onStreamText) || (() => {}),
            AIM?.onNativeAction?.(onNativeAction) || (() => {}),
            AIM?.onActionPending?.(onActionPending) || (() => {}),
            AIM?.onActionResult?.(onActionResult) || (() => {}),
            AIM?.onAiDone?.(onDone) || (() => {}),
            AIM?.onAiError?.(onError) || (() => {}),
        );

        const history = messagesRef.current
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.status !== 'streaming')
            .map((m) => ({ role: m.role, content: m.text }));

        AIM?.sendPrompt?.({
            traceId: assistantId,
            prompt: trimmed,
            history,
            settings: { ...(freshSettings || aiSettings), autoApprovalMode },
            workspaceRoot,
            ideContext,
        });
    };

    const cancelCurrentTask = () => {
        const traceId = activeTraceIdRef.current;
        if (!traceId) return;

        // Detach stream listeners immediately so the current response is dropped in UI.
        try {
            activeCleanupRef.current?.();
        } catch {
            // no-op
        }

        setMessages((current) =>
            updateMessageById(current, traceId, (msg) => ({
                ...msg,
                status: 'done',
                text: msg.text && msg.text.trim().length
                    ? `${msg.text}\n\n[Task dropped by user.]`
                    : '[Task dropped by user.]',
            })),
        );

        setIsSending(false);
        activeTraceIdRef.current = '';
        void AIM?.cancelSession?.({ traceId });
    };

    // ── Action approve/deny ───────────────────────────────────────────

    const approveWorkspaceAction = async (action) => {
        const actionId = String(action?.actionId || '').trim();
        if (!actionId) return;

        const currentActionState = workspaceActionState[actionId];

        setDeniedActionIds((current) => current.filter((id) => id !== actionId));
        setWorkspaceActionState((current) => ({
            ...current,
            [actionId]: { ...(current[actionId] || {}), status: 'running', phase: 'executing', detail: '' },
        }));

        const activeTraceId = String(activeTraceIdRef.current || '').trim();
        const shouldUseRuntimeApproval = Boolean(
            isSending
            && activeTraceId
            && currentActionState?.phase === 'awaiting_approval',
        );

        if (shouldUseRuntimeApproval) {
            await AIM?.respondToAction?.({ traceId: activeTraceId, actionId, approved: true });
            return;
        }

        const result = await executeWorkspaceActionDirect(action);
        setWorkspaceActionState((current) => ({
            ...current,
            [actionId]: {
                ...(current[actionId] || {}),
                status: result?.ok ? 'success' : 'error',
                phase: result?.ok ? 'succeeded' : 'failed',
                detail: result?.ok ? '' : String(result?.error || 'Action failed.'),
            },
        }));

        if (result?.ok) {
            setAppliedActionIds((current) => (current.includes(actionId) ? current : [...current, actionId]));
        }
    };

    const denyWorkspaceAction = (action) => {
        const actionId = String(action?.actionId || '').trim();
        if (!actionId) return;
        setDeniedActionIds((current) => (current.includes(actionId) ? current : [...current, actionId]));
        setWorkspaceActionState((current) => ({ ...current, [actionId]: { status: 'denied', phase: 'cancelled', errorCategory: 'user-denied', detail: 'Denied by user.' } }));
        void AIM?.respondToAction?.({ traceId: activeTraceIdRef.current, actionId, approved: false });
    };

    useEffect(() => {
        const pendingAutoActions = [];

        for (const message of messages) {
            if (message?.role !== 'assistant') {
                continue;
            }

            const workspaceActions = Array.isArray(message.workspaceActions) ? message.workspaceActions : [];
            for (const action of workspaceActions) {
                const actionId = String(action?.actionId || '').trim();
                if (!actionId) {
                    continue;
                }

                if (appliedRef.current.includes(actionId) || deniedRef.current.includes(actionId)) {
                    continue;
                }

                const state = workspaceActionState[actionId];
                if (state?.status === 'running' || state?.status === 'queued' || state?.status === 'success' || state?.status === 'error') {
                    continue;
                }

                const isTerminal = String(action?.type || '').trim() === 'terminal-command';
                if (isTerminal || !shouldAutoApproveAction(action, autoApprovalMode)) {
                    continue;
                }

                pendingAutoActions.push(action);
            }
        }

        if (!pendingAutoActions.length) {
            return;
        }

        setWorkspaceActionState((current) => {
            const next = { ...current };
            for (const action of pendingAutoActions) {
                const actionId = String(action?.actionId || '').trim();
                if (!actionId) {
                    continue;
                }

                const existing = next[actionId];
                if (existing?.status === 'running' || existing?.status === 'queued' || existing?.status === 'success' || existing?.status === 'error') {
                    continue;
                }

                next[actionId] = {
                    ...(existing || {}),
                    status: 'queued',
                    phase: 'auto-approval',
                    detail: 'Queued for automatic apply.',
                };
            }

            return next;
        });

        for (const action of pendingAutoActions) {
            void approveWorkspaceAction(action);
        }
    }, [messages, autoApprovalMode, workspaceActionState, approveWorkspaceAction]);

    const handleNewSession = () => {
        setPrompt('');
        setWorkspaceActionState({});
        setAppliedActionIds([]);
        setDeniedActionIds([]);
        activeTraceIdRef.current = '';
        setMessages(DEFAULT_MESSAGES);
        setTimeout(autoScroll, 0);
    };

    const handlePromptKeyDown = (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        if (event.nativeEvent?.isComposing) return;
        event.preventDefault();
        void sendPrompt({ preventDefault: () => {} });
    };

    // ── Render ────────────────────────────────────────────────────────

    const renderedMessages = useMemo(
        () =>
            messages
                .filter((m) => !m?.hidden && (m?.role === 'user' || m?.role === 'assistant'))
                .map((m) => (
                    <ChatMessageItem
                        key={m.id}
                        message={m}
                        onApplyCode={onApplyCode}
                        workspaceActionState={workspaceActionState}
                        autoApprovalMode={autoApprovalMode}
                        appliedActionIds={appliedActionIds}
                        onApproveWorkspaceAction={approveWorkspaceAction}
                        onDenyWorkspaceAction={denyWorkspaceAction}
                    />
                )),
        [
            messages,
            onApplyCode,
            workspaceActionState,
            appliedActionIds,
            autoApprovalMode,
            approveWorkspaceAction,
            denyWorkspaceAction,
        ],
    );

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[#0f1319]">
            <ChatHeaderBar
                onNewSession={handleNewSession}
                lmStudioModel={aiSettings?.lmStudio?.activeModel || ''}
            />
            <div ref={viewportRef} className="flex-1 space-y-2 overflow-y-auto p-2">
                {renderedMessages}
            </div>
            <ChatComposer
                ref={composerRef}
                prompt={prompt}
                onPromptChange={setPrompt}
                onPromptKeyDown={handlePromptKeyDown}
                onSubmit={sendPrompt}
                onCancel={cancelCurrentTask}
                isSending={isSending}
            />
        </div>
    );
}

export default ChatPanel;
