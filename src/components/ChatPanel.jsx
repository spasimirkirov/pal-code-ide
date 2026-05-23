import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CHAT_SESSION_ID, defaultAiSettings } from '../config/aiConfig';
import ChatComposer from './chat/ChatComposer';
import ChatHeaderBar from './chat/ChatHeaderBar';
import ChatMessageItem from './chat/ChatMessageItem';

const runtime = window.palRuntime;
const electronAPI = window.electronAPI;
const AIM = window.aiRuntime;
const DEFAULT_MESSAGES = [
    { id: 'system-1', role: 'assistant', text: 'Agent online. Ask for architecture, refactors, or full-file code updates.', status: 'done' },
];

const updateMessageById = (messages, id, updater) =>
    messages.map((msg) => (msg.id === id ? (typeof updater === 'function' ? updater(msg) : updater) : msg));

function ChatPanel({ onApplyCode, workspaceRoot, onModelMetricsUpdate, autoApprovalMode, onAutoApprovalModeChange, settingsRefreshKey }) {
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
            { id: assistantId, role: 'assistant', text: '', thinking: '', executionSteps: [], status: 'streaming' },
        ]);

        // Per-session event subscriptions
        const unsubs = [];
        let actionsDuringStream = [];
        let accumulatedText = '';

        const onChunk = (payload) => {
            if (payload.traceId !== assistantId) return;
            accumulatedText += payload.text;
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg, text: (msg.text || '') + payload.text,
            })));
        };

        const onThinking = (payload) => {
            if (payload.traceId !== assistantId) return;
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg, thinking: (msg.thinking || '') + payload.text,
            })));
        };

        const onStreamText = (payload) => {
            if (payload.traceId !== assistantId) return;
            accumulatedText = payload.text;
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg, text: payload.text,
            })));
        };

        const onNativeAction = (payload) => {
            if (payload.traceId !== assistantId) return;
            actionsDuringStream.push(payload.action);
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg, workspaceActions: [...(msg.workspaceActions || []), payload.action],
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
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg,
                text: payload.text || msg.text,
                status: 'done',
                workspaceActions: finalActions || msg.workspaceActions,
            })));
            setIsSending(false);
            activeTraceIdRef.current = '';
            setTimeout(autoScroll, 0);
        };

        const onError = (payload) => {
            if (payload.traceId !== assistantId) return;
            cleanup();
            const isModelError = /no model/i.test(String(payload.error || ''));
            setMessages((current) => updateMessageById(current, assistantId, (msg) => ({
                ...msg,
                text: isModelError
                    ? `Backend unavailable: ${payload.error}\n\nFix:\n1) If using LM Studio: load/select a model in AI Assistant -> LM Studio.\n2) If using Ollama: start Ollama and select an Active Model in AI Assistant -> Ollama.`
                    : `Backend unavailable: ${payload.error}`,
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
        const actionId = action?.actionId;
        if (actionId) {
            setDeniedActionIds((current) => current.filter((id) => id !== actionId));
            await AIM?.respondToAction?.({ traceId: activeTraceIdRef.current, actionId, approved: true });
        }
    };

    const denyWorkspaceAction = (action) => {
        const actionId = String(action?.actionId || '').trim();
        if (!actionId) return;
        setDeniedActionIds((current) => (current.includes(actionId) ? current : [...current, actionId]));
        setWorkspaceActionState((current) => ({ ...current, [actionId]: { status: 'denied', phase: 'cancelled', errorCategory: 'user-denied', detail: 'Denied by user.' } }));
        void AIM?.respondToAction?.({ traceId: activeTraceIdRef.current, actionId, approved: false });
    };

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
        [messages, onApplyCode, workspaceActionState, appliedActionIds],
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
