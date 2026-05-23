const { LRUCache } = require('lru-cache');

const loadedModelCache = new LRUCache({ max: 1, ttl: 5 * 1000 });

const getEndpointUrl = (settings) => {
    return String(settings?.lmStudio?.endpointUrl || 'http://localhost:1234').replace(/\/+$/, '');
};

const normalizeModelId = (rawId) => {
    return String(rawId || '').split(/[\\/]/).pop() || rawId || '';
};

const fetchJson = async (url, options = {}) => {
    const resp = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`LM Studio API error ${resp.status} for ${url}: ${text.substring(0, 200)}`);
    }
    return resp.json();
};

const getLoadedModels = async (settings) => {
    const base = getEndpointUrl(settings);
    const data = await fetchJson(`${base}/api/v1/models`);
    if (!data?.models) return [];
    return data.models
        .filter((m) => Array.isArray(m.loaded_instances) && m.loaded_instances.length > 0)
        .map((m) => ({ key: m.key, displayName: m.display_name, instances: m.loaded_instances }));
};

const isModelLoaded = async (settings, modelKey) => {
    const loaded = await getLoadedModels(settings);
    return loaded.some((m) => m.key === modelKey);
};

const loadModel = async (settings, modelKey, options = {}) => {
    const base = getEndpointUrl(settings);
    const contextLength = options.contextLength || 16384;
    const body = { model: modelKey, context_length: contextLength };
    if (options.flashAttention !== undefined) body.flash_attention = options.flashAttention;
    return fetchJson(`${base}/api/v1/models/load`, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: options.signal || AbortSignal.timeout(120000),
    });
};

const unloadModel = async (settings, instanceId) => {
    const base = getEndpointUrl(settings);
    return fetchJson(`${base}/api/v1/models/unload`, {
        method: 'POST',
        body: JSON.stringify({ instance_id: instanceId }),
        signal: AbortSignal.timeout(30000),
    });
};

const ensureModelLoaded = async (settings, modelId, options = {}) => {
    const modelKey = normalizeModelId(modelId);
    if (!modelKey) throw new Error('No model ID specified for LM Studio auto-load');

    const cached = loadedModelCache.get('lastLoaded');
    if (cached === modelKey) return { loaded: true, modelKey, fromCache: true };

    const loaded = await getLoadedModels(settings);
    const alreadyLoaded = loaded.find((m) => m.key === modelKey);
    if (alreadyLoaded) {
        loadedModelCache.set('lastLoaded', modelKey);
        return { loaded: true, modelKey, fromCache: false, alreadyLoaded: true };
    }

    if (loaded.length > 0) {
        for (const m of loaded) {
            for (const instance of m.instances) {
                try {
                    await unloadModel(settings, instance);
                } catch { }
            }
        }
    }

    const result = await loadModel(settings, modelKey, options);
    loadedModelCache.set('lastLoaded', modelKey);
    return { loaded: true, modelKey, loadTime: result.load_time_seconds };
};

module.exports = { getLoadedModels, isModelLoaded, loadModel, unloadModel, ensureModelLoaded };
