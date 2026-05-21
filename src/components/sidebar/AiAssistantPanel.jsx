import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, DownloadCloud, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';

const runtime = window.palRuntime;

const defaultSettings = {
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

const LLAMA_SERVER_FLAVORS = [
    { value: 'auto', label: 'Auto' },
    { value: 'cpu', label: 'CPU' },
    { value: 'cuda', label: 'CUDA' },
    { value: 'vulkan', label: 'Vulkan' },
];

function AiAssistantPanel() {
    const [activeSubTab, setActiveSubTab] = useState('llama-server');
    const [settings, setSettings] = useState(defaultSettings);
    const [localModels, setLocalModels] = useState([]);
    const [modelsDir, setModelsDir] = useState('');
    const [loadingModels, setLoadingModels] = useState(false);
    const [llamaServers, setLlamaServers] = useState([]);
    const [selectedServerFlavor, setSelectedServerFlavor] = useState('auto');
    const [serverDownloading, setServerDownloading] = useState(false);
    const [lmStudioModels, setLmStudioModels] = useState([]);
    const [lmStudioLoading, setLmStudioLoading] = useState(false);
    const [lmStudioError, setLmStudioError] = useState('');

    const resolveLocalModelPath = (value, models) => {
        const nextValue = String(value || '').trim();
        if (!nextValue) {
            return '';
        }

        const directMatch = models.find((model) => model.localPath === nextValue);
        if (directMatch) {
            return directMatch.localPath;
        }

        const byFileName = models.find((model) => model.fileName === nextValue || model.name === nextValue);
        return byFileName ? byFileName.localPath : nextValue;
    };

    const hydrate = async () => {
        try {
            const [nextSettings, localState, serverState] = await Promise.all([
                runtime?.getAiAssistantSettings?.(),
                runtime?.checkLocalModels?.(),
                runtime?.checkLocalLlamaServers?.(),
            ]);

            const nextLocalModels = Array.isArray(localState?.models) ? localState.models : [];
            if (nextSettings) {
                setSettings({
                    ...nextSettings,
                    roleMappings: {
                        coding: resolveLocalModelPath(nextSettings.roleMappings?.coding, nextLocalModels),
                        vision: resolveLocalModelPath(nextSettings.roleMappings?.vision, nextLocalModels),
                        autocomplete: resolveLocalModelPath(nextSettings.roleMappings?.autocomplete, nextLocalModels),
                    },
                });

                const migrated = {
                    engine: nextSettings.engine,
                    roleMappings: {
                        coding: resolveLocalModelPath(nextSettings.roleMappings?.coding, nextLocalModels),
                        vision: resolveLocalModelPath(nextSettings.roleMappings?.vision, nextLocalModels),
                        autocomplete: resolveLocalModelPath(nextSettings.roleMappings?.autocomplete, nextLocalModels),
                    },
                    lmStudio: nextSettings.lmStudio,
                };

                if (JSON.stringify(migrated) !== JSON.stringify(nextSettings)) {
                    void runtime?.setAiAssistantSettings?.(migrated);
                }
            }
            if (localState) {
                setLocalModels(nextLocalModels);
                setModelsDir(String(localState.modelsDir || ''));
            }
            setLlamaServers(Array.isArray(serverState?.versions) ? serverState.versions : []);
        } catch {
            // Ignore hydrate errors and keep defaults.
        }
    };

    useEffect(() => {
        let mounted = true;
        let unsubscribe = null;

        const init = async () => {
            if (!mounted) {
                return;
            }
            setLoadingModels(true);
            await hydrate();
            if (mounted) {
                setLoadingModels(false);
            }
        };

        void init();

        return () => {
            mounted = false;
            if (unsubscribe) {
                unsubscribe();
            }
        };
    }, []);

    const downloadedModels = useMemo(
        () => localModels.filter((model) => model.downloaded),
        [localModels],
    );

    const updateSettings = async (patch) => {
        const next = await runtime?.setAiAssistantSettings?.(patch);
        if (next) {
            setSettings(next);
        }
    };

    const startLlamaServerDownload = async () => {
        try {
            setServerDownloading(true);
            await runtime?.downloadLlamaServerVersion?.({ flavor: selectedServerFlavor });
            await hydrate();
        } catch (error) {
            setLmStudioError(error?.message || 'Download failed.');
        } finally {
            setServerDownloading(false);
        }
    };

    const refreshLmStudioModels = async () => {
        try {
            setLmStudioError('');
            setLmStudioLoading(true);
            const response = await runtime?.lmStudioGetModels?.({
                endpointUrl: settings.lmStudio.endpointUrl,
                port: settings.lmStudio.port,
            });
            setLmStudioModels(Array.isArray(response?.models) ? response.models : []);
        } catch (error) {
            setLmStudioError(error?.message || 'Could not fetch LM Studio models.');
        } finally {
            setLmStudioLoading(false);
        }
    };

    return (
        <section className="h-full overflow-y-auto bg-[#0f1319] p-3 text-xs text-slate-200">
            <div className="mb-3 flex items-center gap-2 border-b border-slate-800 pb-2">
                <Sparkles className="h-4 w-4 text-cyan-200" />
                <h3 className="font-semibold uppercase tracking-[0.1em] text-cyan-100">AI Assistant</h3>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
                <button
                    type="button"
                    onClick={() => setActiveSubTab('llama-server')}
                    className={`rounded-lg border px-2 py-1.5 font-medium transition ${activeSubTab === 'llama-server'
                            ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100'
                            : 'border-slate-700 bg-slate-900/70 text-slate-300'
                        }`}
                >
                    Llama.cpp Server
                </button>
                <button
                    type="button"
                    onClick={() => setActiveSubTab('lm-studio')}
                    className={`rounded-lg border px-2 py-1.5 font-medium transition ${activeSubTab === 'lm-studio'
                            ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100'
                            : 'border-slate-700 bg-slate-900/70 text-slate-300'
                        }`}
                >
                    LM Studio
                </button>
            </div>

            {activeSubTab === 'llama-server' ? (
                <div className="space-y-3">
                    <p className="text-[11px] text-slate-400">Managed models folder: {modelsDir || 'loading...'}</p>

                    <div className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <h4 className="font-semibold uppercase tracking-[0.09em] text-slate-300">Llama.cpp Server Versions</h4>
                            <button
                                type="button"
                                onClick={() => void hydrate()}
                                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-300 hover:text-cyan-100"
                            >
                                Refresh
                            </button>
                        </div>
                        <div className="mb-3 flex items-end gap-2">
                            <label className="flex-1">
                                <span className="mb-1 block text-[11px] text-slate-400">Select Version</span>
                                <select
                                    value={selectedServerFlavor}
                                    onChange={(event) => setSelectedServerFlavor(event.target.value)}
                                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-100"
                                >
                                    {LLAMA_SERVER_FLAVORS.map((item) => (
                                        <option key={item.value} value={item.value}>{item.label}</option>
                                    ))}
                                </select>
                            </label>
                            <button
                                type="button"
                                onClick={() => void startLlamaServerDownload()}
                                disabled={serverDownloading}
                                className="inline-flex items-center gap-1 rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 py-2 text-[11px] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {serverDownloading ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <DownloadCloud className="h-3.5 w-3.5" />
                                )}
                                Download
                            </button>
                        </div>
                        <div className="space-y-2">
                            {LLAMA_SERVER_FLAVORS.map((flavor) => {
                                const version = llamaServers.find((item) => item.flavor === flavor.value);
                                return (
                                    <div key={flavor.value} className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/60 px-2 py-2">
                                        <div>
                                            <p className="text-sm text-slate-100">{flavor.label}</p>
                                            <p className="text-[10px] text-slate-500">
                                                {version?.installed ? 'Installed' : 'Not installed'}
                                                {version?.active ? ' · Active' : ''}
                                            </p>
                                        </div>
                                        {version?.installed ? (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">
                                                <CheckCircle2 className="h-3 w-3" /> Ready
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-slate-500">Use the selector above to download</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {loadingModels ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-slate-400">Loading model list...</div>
                    ) : (
                        localModels.length ? localModels.map((model) => {
                            return (
                                <article key={model.id} className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <p className="font-semibold text-slate-100">{model.name}</p>
                                            <p className="mt-1 break-all text-[10px] text-slate-500">{model.fileName}</p>
                                        </div>
                                        {model.downloaded && (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                                                <CheckCircle2 className="h-3 w-3" />
                                                Downloaded
                                            </span>
                                        )}
                                    </div>
                                </article>
                            );
                        }) : (
                            <div className="rounded-lg border border-dashed border-slate-700/70 bg-slate-900/35 p-3 text-xs text-slate-500">
                                No local GGUF files found in the models folder.
                            </div>
                        )
                    )}

                    <div className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
                        <h4 className="mb-2 font-semibold uppercase tracking-[0.09em] text-slate-300">Role Mapping</h4>
                        <div className="space-y-2">
                            <label className="block text-slate-300">
                                <span className="mb-1 block">Primary Coding</span>
                                <select
                                    value={settings.roleMappings.coding || ''}
                                    onChange={(event) => void updateSettings({ roleMappings: { coding: event.target.value } })}
                                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                                >
                                    <option value="">Select local model</option>
                                    {downloadedModels.map((model) => (
                                        <option key={model.id} value={model.localPath}>{model.name}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block text-slate-300">
                                <span className="mb-1 block">Primary Vision</span>
                                <select
                                    value={settings.roleMappings.vision || ''}
                                    onChange={(event) => void updateSettings({ roleMappings: { vision: event.target.value } })}
                                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                                >
                                    <option value="">Select local model</option>
                                    {downloadedModels.map((model) => (
                                        <option key={model.id} value={model.localPath}>{model.name}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block text-slate-300">
                                <span className="mb-1 block">Primary Autocomplete</span>
                                <select
                                    value={settings.roleMappings.autocomplete || ''}
                                    onChange={(event) => void updateSettings({ roleMappings: { autocomplete: event.target.value } })}
                                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                                >
                                    <option value="">Select local model</option>
                                    {downloadedModels.map((model) => (
                                        <option key={model.id} value={model.localPath}>{model.name}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <label className="block">
                        <span className="mb-1 block text-slate-300">Endpoint URL</span>
                        <input
                            type="text"
                            value={settings.lmStudio.endpointUrl}
                            onChange={(event) => {
                                const endpointUrl = event.target.value;
                                setSettings((current) => ({
                                    ...current,
                                    lmStudio: {
                                        ...current.lmStudio,
                                        endpointUrl,
                                    },
                                }));
                            }}
                            onBlur={() => void updateSettings({ lmStudio: { endpointUrl: settings.lmStudio.endpointUrl } })}
                            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                            placeholder="http://localhost:1234"
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-slate-300">Port</span>
                        <input
                            type="text"
                            value={settings.lmStudio.port}
                            onChange={(event) => {
                                const port = event.target.value;
                                setSettings((current) => ({
                                    ...current,
                                    lmStudio: {
                                        ...current.lmStudio,
                                        port,
                                    },
                                }));
                            }}
                            onBlur={() => void updateSettings({ lmStudio: { port: settings.lmStudio.port } })}
                            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                            placeholder="1234"
                        />
                    </label>

                    <button
                        type="button"
                        onClick={() => void refreshLmStudioModels()}
                        disabled={lmStudioLoading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/40 bg-cyan-400/12 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {lmStudioLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        🔄 Get Available Models
                    </button>

                    <label className="block">
                        <span className="mb-1 block text-slate-300">Select Active LM Studio Model</span>
                        <select
                            value={settings.lmStudio.activeModel}
                            onChange={(event) => {
                                const activeModel = event.target.value;
                                void updateSettings({ lmStudio: { activeModel } });
                            }}
                            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs"
                        >
                            <option value="">Select model</option>
                            {lmStudioModels.map((model) => (
                                <option key={model.id} value={model.id}>{model.id}</option>
                            ))}
                        </select>
                    </label>

                    {lmStudioError && (
                        <p className="rounded-md border border-rose-400/30 bg-rose-500/10 p-2 text-[11px] text-rose-200">
                            {lmStudioError}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}

export default AiAssistantPanel;