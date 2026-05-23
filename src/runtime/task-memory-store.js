import path from 'node:path';
import fs from 'node:fs';

const normalizePathKey = (value) =>
    String(value || '')
        .replace(/\\/g, '/')
        .trim()
        .toLowerCase()
        .replace(/^\/+|\/+$/g, '');

export const createTaskMemoryStore = ({ dbPath, logger } = {}) => {
    const resolvedStorePath = String(dbPath || '').trim();
    const pathMemory = new Map();
    const toolEvents = [];
    let dirty = false;
    let flushTimer = null;
    const MAX_EVENTS = 5000;

    const flushToDisk = () => {
        if (!resolvedStorePath || !dirty) return;
        try {
            fs.mkdirSync(path.dirname(resolvedStorePath), { recursive: true });
            const payload = {
                version: 1,
                updatedAt: Date.now(),
                pathMemory: Object.fromEntries(pathMemory.entries()),
                toolEvents,
            };
            const tempPath = `${resolvedStorePath}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(payload), 'utf-8');
            fs.renameSync(tempPath, resolvedStorePath);
            dirty = false;
        } catch (error) {
            logger?.warn?.({ error: String(error?.message || error), storePath: resolvedStorePath }, 'Task memory store flush failed');
        }
    };

    const scheduleFlush = () => {
        dirty = true;
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushToDisk();
        }, 250);
        if (typeof flushTimer?.unref === 'function') {
            flushTimer.unref();
        }
    };

    if (resolvedStorePath) {
        try {
            if (fs.existsSync(resolvedStorePath)) {
                const raw = fs.readFileSync(resolvedStorePath, 'utf-8');
                const parsed = JSON.parse(raw || '{}');
                const restoredPathMemory = parsed?.pathMemory && typeof parsed.pathMemory === 'object' ? parsed.pathMemory : {};
                for (const [k, v] of Object.entries(restoredPathMemory)) {
                    const key = normalizePathKey(k);
                    const value = String(v || '').trim();
                    if (key && value) {
                        pathMemory.set(key, value);
                    }
                }

                const restoredEvents = Array.isArray(parsed?.toolEvents) ? parsed.toolEvents : [];
                for (const event of restoredEvents.slice(-MAX_EVENTS)) {
                    if (!event || typeof event !== 'object') continue;
                    const traceId = String(event.traceId || '').trim();
                    const toolName = String(event.toolName || '').trim();
                    if (!traceId || !toolName) continue;
                    toolEvents.push({
                        traceId,
                        toolName,
                        actionType: String(event.actionType || ''),
                        ok: event.ok ? 1 : 0,
                        blockedLoop: event.blockedLoop ? 1 : 0,
                        ms: Number.isFinite(event.ms) ? Math.max(0, Math.round(event.ms)) : null,
                        error: event.error ? String(event.error) : null,
                        createdAt: Number(event.createdAt) || Date.now(),
                    });
                }
            }

            logger?.info?.({ storePath: resolvedStorePath }, 'Task memory store initialized');
        } catch (error) {
            logger?.warn?.({ error: String(error?.message || error), storePath: resolvedStorePath }, 'Task memory store could not restore persisted state');
        }
    }

    const getResolvedPath = async (rawPath) => {
        const key = normalizePathKey(rawPath);
        if (!key) return '';

        return String(pathMemory.get(key) || '');
    };

    const rememberResolvedPath = async (rawPath, resolvedPath) => {
        const key = normalizePathKey(rawPath);
        const value = String(resolvedPath || '').trim();
        if (!key || !value) return;

        pathMemory.set(key, value);
        scheduleFlush();
    };

    const recordToolExecution = async ({ traceId, toolName, actionType, ok, blockedLoop, ms, error }) => {
        const event = {
            traceId: String(traceId || ''),
            toolName: String(toolName || ''),
            actionType: String(actionType || ''),
            ok: ok ? 1 : 0,
            blockedLoop: blockedLoop ? 1 : 0,
            ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null,
            error: error ? String(error) : null,
            createdAt: Date.now(),
        };

        if (!event.traceId || !event.toolName) return;

        toolEvents.push(event);
        if (toolEvents.length > MAX_EVENTS) {
            toolEvents.splice(0, toolEvents.length - MAX_EVENTS);
        }
        scheduleFlush();
    };

    const getTraceSummary = async (traceId) => {
        const key = String(traceId || '').trim();
        if (!key) {
            return { total: 0, okCount: 0, failedCount: 0, editCount: 0, readCount: 0 };
        }

        const traceEvents = toolEvents.filter((event) => event.traceId === key);
        return {
            total: traceEvents.length,
            okCount: traceEvents.filter((event) => event.ok === 1).length,
            failedCount: traceEvents.filter((event) => event.ok === 0).length,
            editCount: traceEvents.filter((event) => {
                const type = String(event.actionType || '');
                return [
                    'write-file', 'patch-file', 'delete-file', 'create-folder',
                    'patch-search-replace', 'patch-unified-diff', 'patch-rollback',
                    'patch_search_replace', 'patch_unified_diff', 'patch_rollback',
                ].includes(type);
            }).length,
            readCount: traceEvents.filter((event) => String(event.actionType || '') === 'read-file').length,
        };
    };

    const dispose = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        flushToDisk();
    };

    return {
        getResolvedPath,
        rememberResolvedPath,
        recordToolExecution,
        getTraceSummary,
        dispose,
    };
};