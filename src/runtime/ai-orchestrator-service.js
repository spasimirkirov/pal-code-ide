import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { parseSearchReplaceEditBlocks } from '../utils/aiHelpers';
import { SYSTEM_PROMPT, EDIT_SYSTEM_PROMPT, CHAT_HISTORY_WINDOW, MAX_CONTEXT_TOKENS } from '../config/aiConfig';
import { createAiSdkService } from './ai-sdk-service';
import { createTaskMemoryStore } from './task-memory-store';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.vite', 'dist', 'out', '.next', '.cache', '__pycache__']);

const orchestratorTracer = trace.getTracer('pal.ai.orchestrator');

export const createAiOrchestratorService = ({ getMainWindow, getWorkspaceRoot, workspaceIndex, mcpToolsService, projectMetadataService, codeSearchService, patchService, validationService, agentMemoryDbPath }) => {
    const activeSessions = new Map();
    const logger = pino({ name: 'pal-ai-orchestrator', level: process.env.PAL_LOG_LEVEL || 'info' });
    const taskMemory = createTaskMemoryStore({ dbPath: agentMemoryDbPath, logger });
    const aiSdk = createAiSdkService();

    const emit = (channel, payload) => {
        const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    };

    // ── Context Building ─────────────────────────────────────────────────

    const getTreeSummary = (workspaceRoot) => {
        try {
            const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
            return entries
                .filter((e) => !IGNORED_DIRS.has(e.name))
                .map((e) => `  ${e.name}${e.isDirectory() ? '/' : ''}`)
                .join('\n');
        } catch { return '(unreadable)'; }
    };

    const buildWorkspaceContext = (workspaceRoot) => {
        if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return '';
        return `Project root: ${workspaceRoot}\nTop-level contents:\n${getTreeSummary(workspaceRoot)}`;
    };

    const buildReferencedFileContext = (prompt) => {
        const refs = [];
        const refRegex = /(?:^|[\s"'`(])([A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)/g;
        let m;
        while ((m = refRegex.exec(prompt)) !== null) {
            const p = m[1].trim();
            if (p && !p.startsWith('http')) refs.push(p);
        }
        return { hasContext: refs.length > 0, contextText: '' };
    };

    const buildIdeContextSummary = (ideContext) => {
        if (!ideContext) return '';
        const parts = [];
        if (ideContext.activeFilePath) parts.push(`Active file: ${ideContext.activeFilePath}`);
        if (ideContext.selection) parts.push(`Selection: ${ideContext.selection}`);
        return parts.join('\n');
    };

    const estimateTokens = (str) => Math.ceil(String(str || '').length / 4);

    // ── Edit detection ───────────────────────────────────────────────────

    const EDIT_VERBS = /\b(implement|fix|add|create|update|modify|refactor|rename|remove|delete|move|change|wire|integrate|build|make|clear|empty|reset|wipe|purge|clean|edit|write|insert|set|generate|convert|transform|replace|bump|upgrade|downgrade|migrate|port|rewrite|rework|redesign|restructure|simplify|optimize|improve|enhance|extend|reduce|increase)\b/i;

    const isEditIntent = (prompt) => EDIT_VERBS.test(String(prompt || ''));

    // ── SEARCH/REPLACE Execution ─────────────────────────────────────────

    const applyEditActions = async (actions, workspaceRoot) => {
        const results = [];
        for (const action of actions) {
            const { type, path: relPath, search, replace } = action;
            const absPath = path.resolve(workspaceRoot, relPath);

            try {
                if (type === 'delete') {
                    if (fs.existsSync(absPath)) {
                        fs.rmSync(absPath, { recursive: true, force: true });
                        results.push({ ok: true, path: relPath, action: 'deleted' });
                    } else {
                        results.push({ ok: true, path: relPath, action: 'not-found' });
                    }
                } else if (type === 'create') {
                    const dir = path.dirname(absPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(absPath, replace || '', 'utf-8');
                    results.push({ ok: true, path: relPath, action: 'created' });
                } else if (type === 'file' || type === 'edit') {
                    if (!fs.existsSync(absPath)) {
                        results.push({ ok: false, path: relPath, error: 'File not found' });
                        continue;
                    }
                    const content = fs.readFileSync(absPath, 'utf-8');
                    const idx = content.indexOf(search);
                    if (idx === -1) {
                        results.push({ ok: false, path: relPath, error: 'SEARCH text not found', search: search.slice(0, 100) });
                        continue;
                    }
                    const newContent = content.slice(0, idx) + replace + content.slice(idx + search.length);
                    fs.writeFileSync(absPath, newContent, 'utf-8');
                    results.push({ ok: true, path: relPath, action: 'edited' });
                }
            } catch (err) {
                results.push({ ok: false, path: relPath, error: String(err.message) });
            }
        }
        return results;
    };

    // ── Main Entry ──────────────────────────────────────────────────────

    const sendPrompt = async ({ traceId, prompt, history, settings, workspaceRoot, ideContext }) => {
        if (!traceId || !prompt) {
            emit('ai:error', { traceId, error: 'Missing required parameters.', recoverable: false });
            return;
        }

        activeSessions.set(traceId, { status: 'running' });
        const runSpan = orchestratorTracer.startSpan('agent.run', {
            attributes: { 'pal.trace_id': traceId, 'pal.workspace_root': String(workspaceRoot || '') },
        });

        try {
            logger.info({ traceId }, 'Agent run started');
            if (!settings?.lmStudio?.activeModel) throw new Error('LM Studio is selected but no model is configured.');

            const editIntent = isEditIntent(prompt);
            const useSdk = !editIntent; // Q&A uses SDK, edit uses SEARCH/REPLACE

            // Build context
            const [workspaceContext, , metadataSummary, codeSummary] = await Promise.all([
                buildWorkspaceContext(workspaceRoot),
                buildReferencedFileContext(prompt),
                projectMetadataService?.getContextSummary?.() || Promise.resolve(''),
                codeSearchService?.getContextSummary?.() || Promise.resolve(''),
            ]);
            const ideContextSummary = buildIdeContextSummary(ideContext);

            let effectivePrompt = prompt;
            if (metadataSummary) effectivePrompt = `${effectivePrompt}\n\nProject info: ${metadataSummary}`;
            if (codeSummary) effectivePrompt = `${effectivePrompt}\n\nCode summary: ${codeSummary}`;
            if (workspaceContext) effectivePrompt = `${effectivePrompt}\n\n${workspaceContext}`;
            if (ideContextSummary) effectivePrompt = `${effectivePrompt}\n\n${ideContextSummary}`;

            const systemPrompt = editIntent ? EDIT_SYSTEM_PROMPT : SYSTEM_PROMPT;
            const historyMessages = Array.isArray(history) ? history.slice(-CHAT_HISTORY_WINDOW) : [];
            const messages = [{ role: 'system', content: systemPrompt }, ...historyMessages, { role: 'user', content: effectivePrompt }];

            if (useSdk) {
                // ── Q&A path: simple text generation ──
                const result = await aiSdk.sendPrompt({
                    traceId, systemPrompt, messages, settings,
                    emit,
                    maxTokens: 4096,
                });

                if (!result) return;

                const text = String(result.text || '');
                emit('ai:done', { traceId, text, actions: [], nativeActions: [] });
                runSpan.setStatus({ code: SpanStatusCode.OK });
                logger.info({ traceId }, 'Q&A completed');
            } else {
                // ── Edit path: SEARCH/REPLACE ──
                await workspaceIndex.ensureFresh();

                const result = await aiSdk.sendPrompt({
                    traceId, systemPrompt, messages, settings,
                    emit,
                    suppressStreamingText: true,
                    maxTokens: 8192,
                });

                if (!result) return;

                const rawText = String(result.text || '');
                const actions = parseSearchReplaceEditBlocks(rawText);

                if (actions.length === 0) {
                    // No SEARCH/REPLACE blocks found — just show the response text
                    emit('ai:done', {
                        traceId,
                        text: `${rawText}\n\n(The model did not output any SEARCH/REPLACE blocks. Try a more specific prompt.)`,
                        actions: [],
                        nativeActions: [],
                    });
                    runSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'no-edit-blocks' });
                    logger.warn({ traceId }, 'No SEARCH/REPLACE blocks found in response');
                    return;
                }

                // Apply the edit actions
                const root = workspaceRoot || (typeof getWorkspaceRoot === 'function' ? getWorkspaceRoot() : null) || process.cwd();
                const editResults = await applyEditActions(actions, root);

                const okCount = editResults.filter((r) => r.ok).length;
                const failCount = editResults.filter((r) => !r.ok).length;
                const summary = [`Applied ${okCount}/${editResults.length} changes.`];
                for (const r of editResults) {
                    if (r.ok) {
                        summary.push(`  ✓ ${r.path} (${r.action})`);
                    } else {
                        summary.push(`  ✗ ${r.path}: ${r.error}`);
                    }
                }

                emit('ai:done', {
                    traceId,
                    text: summary.join('\n'),
                    actions: [],
                    nativeActions: editResults.filter((r) => r.ok).map((r) => ({
                        type: r.action,
                        path: r.path,
                        summary: `${r.action} ${r.path}`,
                    })),
                });

                runSpan.setStatus({ code: failCount > 0 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
                logger.info({ traceId, okCount, failCount }, 'Edit completed');
            }
        } catch (error) {
            runSpan.recordException(error);
            runSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(error?.message || 'AI request failed.') });
            logger.error({ traceId, error: String(error?.message || error) }, 'Agent run failed');
            emit('ai:error', {
                traceId,
                error: String(error?.message || 'AI request failed.'),
                recoverable: false,
            });
        } finally {
            runSpan.end();
            activeSessions.delete(traceId);
        }
    };

    const cancelSession = ({ traceId }) => {
        activeSessions.delete(traceId);
    };

    return { sendPrompt, cancelSession };
};
