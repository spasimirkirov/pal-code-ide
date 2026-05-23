const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const createTimeoutError = (method, timeoutMs) => {
    const error = new Error(`MCP request timed out after ${timeoutMs}ms: ${method}`);
    error.code = 'MCP_REQUEST_TIMEOUT';
    return error;
};

const createCancelledError = (method) => {
    const error = new Error(`MCP request was cancelled: ${method}`);
    error.code = 'MCP_REQUEST_CANCELLED';
    return error;
};

const createRemoteError = (rpcError) => {
    const error = new Error(String(rpcError?.message || 'Remote MCP error'));
    error.code = 'MCP_REMOTE_ERROR';
    error.remoteCode = rpcError?.code;
    error.remoteData = rpcError?.data;
    return error;
};

export const createMcpRequestHandler = ({ sendMessage, onCancelRequest } = {}) => {
    if (typeof sendMessage !== 'function') {
        throw new Error('createMcpRequestHandler requires a sendMessage function.');
    }

    let disposed = false;
    let nextRequestId = 1;
    const pending = new Map();
    const notificationListeners = new Set();
    const serverRequestListeners = new Set();

    const settlePending = ({ id, resolver }) => {
        const entry = pending.get(id);
        if (!entry) {
            return;
        }

        pending.delete(id);
        if (entry.timer) {
            clearTimeout(entry.timer);
        }
        if (typeof entry.unsubscribeAbort === 'function') {
            entry.unsubscribeAbort();
        }

        resolver(entry);
    };

    const sendRpc = (message) => {
        if (disposed) {
            throw new Error('MCP request handler is disposed.');
        }
        sendMessage(message);
    };

    const request = ({ method, params, timeoutMs = 30000, signal } = {}) => {
        const rpcMethod = String(method || '').trim();
        if (!rpcMethod) {
            return Promise.reject(new Error('MCP request method is required.'));
        }

        const boundedTimeoutMs = Math.max(1000, Math.min(300000, Number(timeoutMs) || 30000));
        const requestId = nextRequestId++;

        return new Promise((resolve, reject) => {
            if (disposed) {
                reject(new Error('MCP request handler is disposed.'));
                return;
            }

            const timer = setTimeout(() => {
                settlePending({
                    id: requestId,
                    resolver: () => reject(createTimeoutError(rpcMethod, boundedTimeoutMs)),
                });

                if (typeof onCancelRequest === 'function') {
                    onCancelRequest({ requestId, method: rpcMethod, reason: 'timeout' });
                }
            }, boundedTimeoutMs);

            let unsubscribeAbort = null;
            if (signal && typeof signal.addEventListener === 'function') {
                const onAbort = () => {
                    settlePending({
                        id: requestId,
                        resolver: () => reject(createCancelledError(rpcMethod)),
                    });

                    if (typeof onCancelRequest === 'function') {
                        onCancelRequest({ requestId, method: rpcMethod, reason: 'signal' });
                    }
                };

                signal.addEventListener('abort', onAbort, { once: true });
                unsubscribeAbort = () => signal.removeEventListener('abort', onAbort);
            }

            pending.set(requestId, {
                method: rpcMethod,
                resolve,
                reject,
                timer,
                unsubscribeAbort,
                createdAt: Date.now(),
            });

            sendRpc({
                jsonrpc: '2.0',
                id: requestId,
                method: rpcMethod,
                params: isObject(params) ? params : params ?? {},
            });
        });
    };

    const notify = ({ method, params } = {}) => {
        const rpcMethod = String(method || '').trim();
        if (!rpcMethod) {
            throw new Error('MCP notification method is required.');
        }

        sendRpc({
            jsonrpc: '2.0',
            method: rpcMethod,
            params: isObject(params) ? params : params ?? {},
        });
    };

    const onNotification = (listener) => {
        if (typeof listener !== 'function') {
            return () => { };
        }

        notificationListeners.add(listener);
        return () => {
            notificationListeners.delete(listener);
        };
    };

    const onServerRequest = (listener) => {
        if (typeof listener !== 'function') {
            return () => { };
        }

        serverRequestListeners.add(listener);
        return () => {
            serverRequestListeners.delete(listener);
        };
    };

    const handleMessage = (message) => {
        if (!isObject(message)) {
            return;
        }

        const hasRequestId = Object.prototype.hasOwnProperty.call(message, 'id');
        const hasMethod = typeof message.method === 'string' && message.method.length > 0;

        if (hasRequestId && Object.prototype.hasOwnProperty.call(message, 'result')) {
            settlePending({
                id: message.id,
                resolver: (entry) => entry.resolve(message.result),
            });
            return;
        }

        if (hasRequestId && Object.prototype.hasOwnProperty.call(message, 'error')) {
            settlePending({
                id: message.id,
                resolver: (entry) => entry.reject(createRemoteError(message.error)),
            });
            return;
        }

        if (hasMethod && hasRequestId) {
            for (const listener of serverRequestListeners) {
                try {
                    listener(message);
                } catch {
                    // Ignore individual listener failure.
                }
            }
            return;
        }

        if (hasMethod) {
            for (const listener of notificationListeners) {
                try {
                    listener(message);
                } catch {
                    // Ignore individual listener failure.
                }
            }
        }
    };

    const cancelRequest = (requestId, reason = 'manual') => {
        const entry = pending.get(requestId);
        if (!entry) {
            return false;
        }

        settlePending({
            id: requestId,
            resolver: (item) => item.reject(createCancelledError(item.method)),
        });

        if (typeof onCancelRequest === 'function') {
            onCancelRequest({ requestId, method: entry.method, reason: String(reason || 'manual') });
        }

        return true;
    };

    const dispose = () => {
        if (disposed) {
            return;
        }

        disposed = true;
        const ids = [...pending.keys()];
        for (const requestId of ids) {
            settlePending({
                id: requestId,
                resolver: (entry) => entry.reject(new Error(`MCP request handler disposed during request: ${entry.method}`)),
            });
        }

        notificationListeners.clear();
        serverRequestListeners.clear();
    };

    return {
        request,
        notify,
        handleMessage,
        cancelRequest,
        onNotification,
        onServerRequest,
        getPendingCount: () => pending.size,
        dispose,
    };
};
