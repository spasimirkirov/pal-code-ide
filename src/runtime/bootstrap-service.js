import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import { getRuntimePaths } from './runtime-paths';

const LLAMA_RELEASE_API = 'https://api.github.com/repos/ggerganov/llama.cpp/releases/latest';
const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '';
const LLAMA_BINARY_FLAVOR = (process.env.PAL_LLAMA_BINARY_FLAVOR || 'auto').toLowerCase();
const CODER_MODEL_REPOS = [
    'Qwen/Qwen2.5-Coder-14B-Instruct-GGUF',
    'bartowski/Qwen2.5-Coder-14B-Instruct-GGUF',
];
const VISION_MODEL_REPOS = [
    'unsloth/Qwen2.5-VL-7B-Instruct-GGUF',
    'benxh/Qwen2.5-VL-7B-Instruct-GGUF',
    'Mungert/Qwen2.5-VL-7B-Instruct-GGUF',
];

const isHuggingFaceUrl = (url) => String(url || '').toLowerCase().includes('huggingface.co');

export const createRuntimeBootstrapService = ({ app, getMainWindow }) => {
    const state = {
        running: false,
        controller: null,
        lastProgress: null,
    };

    const ensureDir = async (dirPath) => {
        await fsPromises.mkdir(dirPath, { recursive: true });
    };

    const sendDownloadProgress = (payload) => {
        state.lastProgress = payload;
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('runtime:downloadProgress', payload);
        }
    };

    const readErrorText = async (response) => {
        try {
            const text = await response.text();
            return (text || '').slice(0, 260).replace(/\s+/g, ' ').trim();
        } catch {
            return '';
        }
    };

    const buildHfHeaders = (accept = '*/*') => {
        const headers = {
            'User-Agent': 'PAL-IDE/1.0',
            Accept: accept,
        };

        if (HF_TOKEN) {
            headers.Authorization = `Bearer ${HF_TOKEN}`;
        }

        return headers;
    };

    const buildDownloadHeadersForUrl = (url) => {
        const lower = String(url || '').toLowerCase();
        if (lower.includes('huggingface.co')) {
            return buildHfHeaders('*/*');
        }

        return {
            'User-Agent': 'PAL-IDE/1.0',
            Accept: '*/*',
        };
    };

    const fetchWithHfAuthFallback = async ({ url, signal, accept = '*/*', method = 'GET' }) => {
        const makeRequest = (headers) =>
            fetch(url, {
                method,
                signal,
                headers,
            });

        const isHf = isHuggingFaceUrl(url);
        const baseHeaders = isHf
            ? buildHfHeaders(accept)
            : {
                'User-Agent': 'PAL-IDE/1.0',
                Accept: accept,
            };

        let response = await makeRequest(baseHeaders);
        let authFallbackUsed = false;
        let invalidTokenDetected = false;

        if (isHf && HF_TOKEN && response.status === 401) {
            invalidTokenDetected = true;
            const anonymousHeaders = {
                'User-Agent': 'PAL-IDE/1.0',
                Accept: accept,
            };
            response = await makeRequest(anonymousHeaders);
            authFallbackUsed = true;
        }

        return {
            response,
            authFallbackUsed,
            invalidTokenDetected,
        };
    };

    const fileExists = async (filePath) => {
        try {
            await fsPromises.access(filePath, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    };

    const findFileRecursive = async (startDir, targetName) => {
        const entries = await fsPromises.readdir(startDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(startDir, entry.name);
            if (entry.isFile() && entry.name.toLowerCase() === targetName.toLowerCase()) {
                return fullPath;
            }
            if (entry.isDirectory()) {
                const nested = await findFileRecursive(fullPath, targetName);
                if (nested) {
                    return nested;
                }
            }
        }
        return null;
    };

    const isLlamaServerInstalled = async (paths) => {
        const activeManifestPath = path.join(paths.llamaServerDir, 'active.json');

        if (await fileExists(activeManifestPath)) {
            try {
                const manifestText = await fsPromises.readFile(activeManifestPath, 'utf-8');
                const manifest = JSON.parse(manifestText);
                const executablePath = manifest?.executablePath;
                if (executablePath && (await fileExists(executablePath))) {
                    return true;
                }
            } catch {
                // If manifest is invalid, fall through to directory scan.
            }
        }

        const foundInManagedDirs = await findFileRecursive(paths.llamaServerDir, 'llama-server.exe');
        if (foundInManagedDirs) {
            return true;
        }

        // Legacy fallback from older layout.
        return fileExists(paths.llamaExe);
    };

    const runProcess = async (command, args) =>
        new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stderr = '';
            child.stderr?.on('data', (chunk) => {
                stderr += String(chunk);
            });

            child.on('error', (error) => reject(error));
            child.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(`Process exited with code ${code}. ${stderr.slice(-500)}`));
            });
        });

    const extractArchive = async ({ archivePath, destinationPath }) => {
        if (process.platform === 'win32') {
            const escapedArchive = archivePath.replace(/'/g, "''");
            const escapedDestination = destinationPath.replace(/'/g, "''");
            const script = `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`;

            await runProcess('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                script,
            ]);
            return;
        }

        // Fallback for non-Windows hosts.
        const zip = new AdmZip(archivePath);
        zip.extractAllTo(destinationPath, true);
    };

    const downloadFileWithProgress = async ({
        url,
        destinationPath,
        stage,
        label,
        signal,
    }) => {
        const {
            response,
            authFallbackUsed,
            invalidTokenDetected,
        } = await fetchWithHfAuthFallback({
            url,
            signal,
            accept: '*/*',
            method: 'GET',
        });

        if (authFallbackUsed && invalidTokenDetected) {
            sendDownloadProgress({
                stage,
                label: 'HF token rejected; retrying this file anonymously.',
                percent: 0,
                inProgress: true,
            });
        }

        if (!response.ok || !response.body) {
            const details = await readErrorText(response);
            const invalidTokenHint =
                invalidTokenDetected && isHuggingFaceUrl(url)
                    ? 'Configured HF token appears invalid; anonymous fallback also failed. '
                    : '';
            const hint =
                response.status === 401 || response.status === 403
                    ? 'Source denied access (possibly gated or rate-limited).'
                    : 'HTTP request was rejected by source.';
            throw new Error(
                `Download failed (${response.status}) for ${label} from ${url}. ${invalidTokenHint}${hint}${details ? ` Details: ${details}` : ''}`,
            );
        }

        const totalBytes = Number(response.headers.get('content-length') || 0);
        const writer = fs.createWriteStream(destinationPath);
        const reader = response.body.getReader();
        let downloadedBytes = 0;

        sendDownloadProgress({
            stage,
            label,
            downloadedBytes,
            totalBytes,
            percent: 0,
            inProgress: true,
        });

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            if (signal?.aborted) {
                throw new Error('Download cancelled.');
            }

            const chunk = Buffer.from(value);
            downloadedBytes += chunk.length;
            await new Promise((resolve, reject) => {
                writer.write(chunk, (error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });

            const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
            sendDownloadProgress({
                stage,
                label,
                downloadedBytes,
                totalBytes,
                percent,
                inProgress: true,
            });
        }

        await new Promise((resolve, reject) => {
            writer.end((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });

        sendDownloadProgress({
            stage,
            label,
            downloadedBytes,
            totalBytes,
            percent: 100,
            inProgress: false,
        });
    };

    const resolveModelFromRepo = async ({ repo, preferredPatterns, signal }) => {
        const modelApi = `https://huggingface.co/api/models/${repo}`;
        const {
            response,
            authFallbackUsed,
            invalidTokenDetected,
        } = await fetchWithHfAuthFallback({
            url: modelApi,
            signal,
            accept: 'application/json',
            method: 'GET',
        });

        if (!response.ok) {
            const details = await readErrorText(response);
            const invalidTokenHint =
                invalidTokenDetected
                    ? 'Configured HF token appears invalid; anonymous retry failed. '
                    : '';
            throw new Error(
                `Model metadata fetch failed for ${repo} (${response.status}). ${invalidTokenHint}${details ? `Details: ${details}` : ''}`,
            );
        }

        if (authFallbackUsed && invalidTokenDetected) {
            sendDownloadProgress({
                stage: 'init',
                label: 'HF token invalid. Continuing with anonymous Hugging Face access.',
                percent: 0,
                inProgress: true,
            });
        }

        const json = await response.json();
        const siblings = Array.isArray(json?.siblings) ? json.siblings : [];
        const fileNames = siblings
            .map((entry) => entry?.rfilename)
            .filter((name) => typeof name === 'string' && name.toLowerCase().endsWith('.gguf'));

        for (const pattern of preferredPatterns) {
            const found = fileNames.find((name) => pattern.test(name));
            if (found) {
                return {
                    repo,
                    fileName: found,
                    url: `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(found)}?download=true`,
                };
            }
        }

        if (fileNames.length) {
            const fallback = fileNames[0];
            return {
                repo,
                fileName: fallback,
                url: `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(fallback)}?download=true`,
            };
        }

        throw new Error(`No .gguf files found in ${repo}.`);
    };

    const resolveModelDownloadCandidates = async ({ repos, preferredPatterns, signal }) => {
        const failures = [];
        const candidates = [];

        for (const repo of repos) {
            try {
                const candidate = await resolveModelFromRepo({ repo, preferredPatterns, signal });
                candidates.push(candidate);
            } catch (error) {
                failures.push(`${repo}: ${error.message}`);
            }
        }

        if (candidates.length) {
            return candidates;
        }

        throw new Error(`Unable to resolve model source. ${failures.join(' | ')}`);
    };

    const downloadModelWithFallback = async ({
        candidates,
        destinationPath,
        stage,
        label,
        signal,
    }) => {
        const failures = [];

        for (const candidate of candidates) {
            try {
                sendDownloadProgress({
                    stage,
                    label: `Resolved ${label}: ${candidate.repo}/${candidate.fileName}`,
                    percent: 0,
                    inProgress: true,
                });
                await downloadFileWithProgress({
                    url: candidate.url,
                    destinationPath,
                    stage,
                    label,
                    signal,
                });
                return candidate;
            } catch (error) {
                failures.push(`${candidate.repo}/${candidate.fileName}: ${error.message}`);
                try {
                    await fsPromises.rm(destinationPath, { force: true });
                } catch {
                    // Ignore cleanup errors
                }
            }
        }

        throw new Error(`All model download sources failed for ${label}. ${failures.join(' | ')}`);
    };

    const pickLlamaWindowsAsset = (assets, preferredFlavor = 'auto') => {
        const zipAssets = assets.filter((asset) => {
            const name = String(asset?.name || '').toLowerCase();
            return name.includes('win') && name.endsWith('.zip') && name.includes('bin');
        });

        if (!zipAssets.length) {
            return null;
        }

        const detectNvidiaGpuAvailable = () => {
            if (process.platform !== 'win32') {
                return false;
            }

            try {
                const result = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
                    encoding: 'utf-8',
                    windowsHide: true,
                });
                return result.status === 0 && Boolean((result.stdout || '').trim());
            } catch {
                return false;
            }
        };

        const selectedFlavor = String(preferredFlavor || LLAMA_BINARY_FLAVOR || 'auto').toLowerCase();
        const prefersCuda =
            selectedFlavor === 'cuda' ||
            (selectedFlavor === 'auto' && (LLAMA_BINARY_FLAVOR === 'cuda' || detectNvidiaGpuAvailable()));
        const prefersVulkan = selectedFlavor === 'vulkan' || LLAMA_BINARY_FLAVOR === 'vulkan';
        const prefersCpu = selectedFlavor === 'cpu' || LLAMA_BINARY_FLAVOR === 'cpu';

        const scoreAsset = (asset) => {
            const name = String(asset.name || '').toLowerCase();
            let score = 0;

            if (prefersCuda) {
                if (name.includes('cuda')) score += 90;
                if (name.includes('cpu')) score += 20;
                if (name.includes('vulkan')) score -= 10;
            } else if (prefersVulkan) {
                if (name.includes('vulkan')) score += 90;
                if (name.includes('cpu')) score += 20;
                if (name.includes('cuda')) score -= 10;
            } else if (prefersCpu || LLAMA_BINARY_FLAVOR === 'auto') {
                if (name.includes('cpu')) score += 90;
                if (name.includes('cuda')) score += 10;
                if (name.includes('vulkan')) score += 5;
            }

            if (name.includes('x64')) score += 20;

            return score;
        };

        const sortedAssets = zipAssets.sort((a, b) => scoreAsset(b) - scoreAsset(a));
        if (selectedFlavor !== 'auto') {
            const exactMatches = sortedAssets.filter((asset) => String(asset.name || '').toLowerCase().includes(selectedFlavor));
            return exactMatches.length ? exactMatches : sortedAssets;
        }

        return sortedAssets;
    };

    const resolveFlavorFromAssetName = (assetName) => {
        const name = String(assetName || '').toLowerCase();
        if (name.includes('cuda')) {
            return 'cuda';
        }
        if (name.includes('vulkan')) {
            return 'vulkan';
        }
        return 'cpu';
    };

    const installLlamaServerVersion = async ({ paths, signal, preferredFlavor = 'auto' }) => {
        const release = await fetch(LLAMA_RELEASE_API, {
            signal,
            headers: {
                'User-Agent': 'PAL-IDE/1.0',
                Accept: 'application/vnd.github+json',
            },
        });

        if (!release.ok) {
            throw new Error(`Failed to fetch llama release metadata (${release.status})`);
        }

        const releaseJson = await release.json();
        const assetCandidates = pickLlamaWindowsAsset(releaseJson.assets || [], preferredFlavor);
        if (!assetCandidates?.length) {
            throw new Error('Could not find a Windows llama-server release asset.');
        }

        const installFailures = [];

        const setActiveLlamaExecutable = async ({ executablePath, flavor, assetName }) => {
            const activeManifestPath = path.join(paths.llamaServerDir, 'active.json');
            const manifest = {
                executablePath,
                flavor,
                assetName,
                updatedAt: new Date().toISOString(),
            };
            await fsPromises.writeFile(activeManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
        };

        for (const asset of assetCandidates) {
            const flavor = resolveFlavorFromAssetName(asset.name);
            const flavorDir = path.join(paths.llamaServerDir, flavor);

            try {
                sendDownloadProgress({
                    stage: 'llama-server',
                    label: `Selected llama package: ${asset.name}`,
                    percent: 0,
                    inProgress: true,
                });

                await ensureDir(flavorDir);
                const archivePath = path.join(paths.tempDir, asset.name || `llama-server-${flavor}.zip`);
                await downloadFileWithProgress({
                    url: asset.browser_download_url,
                    destinationPath: archivePath,
                    stage: 'llama-server',
                    label: `Downloading llama-server (${flavor})`,
                    signal,
                });

                sendDownloadProgress({
                    stage: 'llama-server',
                    label: `Extracting llama-server package (${flavor})`,
                    percent: 100,
                    inProgress: true,
                });

                await fsPromises.rm(flavorDir, { recursive: true, force: true });
                await ensureDir(flavorDir);
                await extractArchive({
                    archivePath,
                    destinationPath: flavorDir,
                });

                sendDownloadProgress({
                    stage: 'llama-server',
                    label: `Verifying llama-server executable (${flavor})`,
                    percent: 100,
                    inProgress: true,
                });

                const foundExe = await findFileRecursive(flavorDir, 'llama-server.exe');
                if (!foundExe) {
                    throw new Error(`llama-server.exe not found inside ${asset.name}`);
                }

                await setActiveLlamaExecutable({
                    executablePath: foundExe,
                    flavor,
                    assetName: asset.name,
                });

                sendDownloadProgress({
                    stage: 'llama-server',
                    label: `llama-server installed in llama-server/${flavor} (${path.basename(foundExe)})`,
                    percent: 100,
                    inProgress: false,
                    completed: true,
                });

                return {
                    installedFlavor: flavor,
                    executablePath: foundExe,
                    assetName: asset.name,
                };
            } catch (error) {
                installFailures.push(`${asset.name}: ${error.message}`);
            }
        }

        throw new Error(`Failed to install llama-server from all candidate assets. ${installFailures.join(' | ')}`);
    };

    const prepareRuntimeDirectories = async () => {
        const paths = getRuntimePaths(app);
        await ensureDir(paths.palRoot);
        await ensureDir(paths.llamaServerDir);
        await ensureDir(paths.modelsDir);
        await ensureDir(paths.tempDir);
        return paths;
    };

    const ensureRuntimeAssets = async () => {
        if (state.running) {
            return { status: 'in-progress', progress: state.lastProgress };
        }

        state.running = true;
        state.controller = new AbortController();

        const { signal } = state.controller;
        const paths = getRuntimePaths(app);

        try {
            await prepareRuntimeDirectories();

            sendDownloadProgress({
                stage: 'init',
                label: `Using runtime path: ${paths.palRoot}`,
                percent: 0,
                inProgress: true,
            });

            sendDownloadProgress({
                stage: 'complete',
                label: 'Runtime assets ready',
                percent: 100,
                inProgress: false,
                completed: true,
            });

            return {
                status: 'ready',
                paths,
            };
        } catch (error) {
            if (signal.aborted) {
                sendDownloadProgress({
                    stage: 'cancelled',
                    label: 'Download cancelled',
                    percent: 0,
                    inProgress: false,
                    cancelled: true,
                });
                return { status: 'cancelled' };
            }

            sendDownloadProgress({
                stage: 'error',
                label: error.message || 'Runtime download failed',
                percent: 0,
                inProgress: false,
                error: true,
            });
            throw error;
        } finally {
            state.running = false;
            state.controller = null;
        }
    };

    const cancelRuntimeBootstrap = async () => {
        if (state.controller) {
            state.controller.abort();
        }

        return {
            status: 'cancel-requested',
        };
    };

    return {
        prepareRuntimeDirectories,
        ensureRuntimeAssets,
        cancelRuntimeBootstrap,
        installLlamaServerVersion,
    };
};
