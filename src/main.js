import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import vm from 'node:vm';
import fs from 'fs-extra';
import fsPromises from 'node:fs/promises';
import chokidar from 'chokidar';
import si from 'systeminformation';
import Store from 'electron-store';
import * as nodePty from '@homebridge/node-pty-prebuilt-multiarch';
import started from 'electron-squirrel-startup';
import { getRuntimePaths } from './runtime/runtime-paths';
import { createWorkspaceService } from './runtime/workspace-service';
import { createRuntimeBootstrapService } from './runtime/bootstrap-service';
import { createProjectService } from './runtime/project-service';
import { createWorkspaceIndex } from './runtime/workspace-index';
import { createAiOrchestratorService } from './runtime/ai-orchestrator-service';
import { createProjectMetadataService } from './runtime/project-metadata-service';
import { createCodeSearchService } from './runtime/code-search-service';
import { createPatchService } from './runtime/patch-service';
import { createValidationService } from './runtime/validation-service';
import { createAiderService } from './runtime/aider-service';
import { createOpencodeService } from './runtime/opencode-service';
import { createDatabaseService } from './runtime/database/database-service';
import { createLlamaService } from './llama-server/llama-service';
import { createMcpToolsService } from './mcp-tools/mcp-tools-service';
import {
  WORKSPACE_IGNORED_NAMES,
  WORKSPACE_MAX_TREE_NODES,
  WORKSPACE_SEARCH_MAX_RESULTS,
  WORKSPACE_DIAGNOSTICS_MAX_ISSUES,
  WORKSPACE_DIAGNOSTICS_MAX_FILES,
  SEARCH_EXCLUDED_EXTENSIONS,
} from './shared/workspace-constants';

if (started) {
  app.quit();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return;
  }

  if (mainWindowRef.isMinimized()) {
    mainWindowRef.restore();
  }

  mainWindowRef.focus();
});

let mainWindowRef = null;
let hardwareMonitorTimer = null;
let appIsQuitting = false;
let hardwareSnapshot = {
  vramUsed: 0,
  vramTotal: 0,
};
const terminalSessions = new Map();
let terminalSessionCounter = 1;
let workspaceWatcher = null;

const stopWatchingWorkspace = () => {
  if (!workspaceWatcher) {
    return;
  }

  try {
    workspaceWatcher.close();
  } catch {
    // Ignore watcher shutdown failures.
  }

  workspaceWatcher = null;
};

const startWatchingWorkspace = (windowRef, workspaceRoot) => {
  const targetWindow = windowRef && !windowRef.isDestroyed() ? windowRef : null;
  const rootPath = String(workspaceRoot || '').trim();
  if (!targetWindow || !rootPath) {
    return;
  }

  stopWatchingWorkspace();

  workspaceWatcher = chokidar.watch(rootPath, {
    ignored: /(^|[\/\\])\..|node_modules/,
    persistent: true,
    ignoreInitial: true,
  });

  const broadcastChange = (changedPath) => {
    workspaceIndex.markDirty();
    if (codeSearchService?.markDirty) {
      codeSearchService.markDirty();
    }
    if (!targetWindow.isDestroyed()) {
      targetWindow.webContents.send('workspace:disk-changed');
    }
  };

  workspaceWatcher
    .on('add', broadcastChange)
    .on('change', broadcastChange)
    .on('unlink', broadcastChange)
    .on('addDir', broadcastChange)
    .on('unlinkDir', broadcastChange);
};

const PAL_APPDATA_ROOT = app.getPath('userData');
const PAL_SETTINGS_DIR = path.join(PAL_APPDATA_ROOT, 'settings');
const PAL_DATA_DIR = path.join(PAL_APPDATA_ROOT, 'data');
const CHAT_SESSIONS_DIR = path.join(PAL_DATA_DIR, 'pal-chats');

const simpleGlobMatch = (pattern, target) => {
  const patternStr = String(pattern || '').trim();
  const targetStr = String(target || '').trim();
  if (!patternStr || !targetStr) return false;

  const lowerPattern = patternStr.toLowerCase();
  const lowerTarget = targetStr.toLowerCase();

  if (!lowerPattern.includes('*') && !lowerPattern.includes('?')) {
    return lowerTarget.includes(lowerPattern);
  }

  const regexStr = lowerPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*{2,}/g, '**')
    .replace(/\*\*/g, '$$$$$')
    .replace(/\*/g, '[^/]*')
    .replace(/\$\$\$\$/g, '.*')
    .replace(/\?/g, '[^/]');
  try {
    return new RegExp(`^${regexStr}$`).test(lowerTarget);
  } catch {
    return lowerTarget.includes(lowerPattern);
  }
};
const MAX_RECENT_WORKSPACES = 12;
const WINDOWS_CTRL_C_EXIT_CODE = -1073741510;

const dbProfilesStore = new Store({
  name: 'pal-code-ide-store',
  cwd: PAL_SETTINGS_DIR,
  encryptionKey:
    process.env.PAL_STORE_ENCRYPTION_KEY ||
    'pal-code-ide-local-encryption-key',
  defaults: {
    databaseConnections: [],
  },
});

const appearanceStore = new Store({
  name: 'appearance',
  cwd: PAL_SETTINGS_DIR,
  defaults: {
    paneDimensions: {
      leftSidebarWidth: 360,
      rightChatWidth: 432,
      terminalHeightRatio: 0.27,
    },
  },
});

const aiAssistantStore = new Store({
  name: 'ai-assistant',
  cwd: PAL_SETTINGS_DIR,
  defaults: {
    engine: 'lm-studio',
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
  },
});

const workspaceHistoryStore = new Store({
  name: 'workspace-history',
  cwd: PAL_SETTINGS_DIR,
  defaults: {
    lastWorkspace: '',
    recentWorkspaces: [],
  },
});

const isExistingDirectory = (candidatePath) => {
  if (!candidatePath || typeof candidatePath !== 'string') {
    return false;
  }

  try {
    const resolved = path.resolve(candidatePath);
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
};

const sanitizeRecentWorkspaces = (input) => {
  const source = Array.isArray(input) ? input : [];
  const deduped = [];
  const seen = new Set();

  for (const entry of source) {
    const candidate = String(entry || '').trim();
    if (!candidate || !isExistingDirectory(candidate)) {
      continue;
    }

    const normalized = path.resolve(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(normalized);
    if (deduped.length >= MAX_RECENT_WORKSPACES) {
      break;
    }
  }

  return deduped;
};

const getRecentWorkspaces = () =>
  sanitizeRecentWorkspaces(workspaceHistoryStore.get('recentWorkspaces', []));

const persistWorkspaceHistory = (workspacePath) => {
  if (!isExistingDirectory(workspacePath)) {
    return;
  }

  const normalized = path.resolve(workspacePath);
  const nextRecents = sanitizeRecentWorkspaces([normalized, ...getRecentWorkspaces()]);
  workspaceHistoryStore.set('lastWorkspace', normalized);
  workspaceHistoryStore.set('recentWorkspaces', nextRecents);
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const sanitizePaneDimensions = (input = {}) => ({
  leftSidebarWidth: clamp(Number(input.leftSidebarWidth || 360), 280, 780),
  rightChatWidth: clamp(Number(input.rightChatWidth || 432), 320, 860),
  terminalHeightRatio: clamp(Number(input.terminalHeightRatio || 0.27), 0.16, 0.45),
});

const getPaneDimensions = () => {
  const saved = appearanceStore.get('paneDimensions', {});
  return sanitizePaneDimensions(saved || {});
};

const setPaneDimensions = (payload = {}) => {
  const current = getPaneDimensions();
  const next = sanitizePaneDimensions({
    ...current,
    ...(payload || {}),
  });

  appearanceStore.set('paneDimensions', next);
  return next;
};

const getSavedDatabaseConnections = () => {
  const entries = dbProfilesStore.get('databaseConnections', []);
  return Array.isArray(entries) ? entries : [];
};

const normalizeDbProfile = (payload = {}) => ({
  driver: String(payload.sqlitePath || '').trim()
    ? 'sqlite'
    : String(payload.driver || 'mysql').toLowerCase() === 'sqlite'
      ? 'sqlite'
      : 'mysql',
  alias: String(payload.alias || '').trim(),
  host: String(payload.host || '').trim(),
  port: Number(payload.port || 3306),
  user: String(payload.user || '').trim(),
  password: String(payload.password || ''),
  database: String(payload.database || '').trim(),
  sqlitePath: String(payload.sqlitePath || '').trim(),
  updatedAt: new Date().toISOString(),
});

  const sanitizeAiAssistantSettings = (input = {}) => {
    const roleMappings = input?.roleMappings || {};
    const lmStudio = input?.lmStudio || {};
    const aider = input?.aider || {};
    const opencode = input?.opencode || {};

    const allowedAgentTypes = ['built-in', 'aider', 'opencode'];

    const rawAgentType = String(input?.agentType || 'built-in').toLowerCase();

    return {
      engine: 'lm-studio',
      agentType: allowedAgentTypes.includes(rawAgentType) ? rawAgentType : 'built-in',
      roleMappings: {
        coding: String(roleMappings.coding || ''),
        vision: String(roleMappings.vision || ''),
        autocomplete: String(roleMappings.autocomplete || ''),
      },
      lmStudio: {
        endpointUrl: String(lmStudio.endpointUrl || 'http://localhost:1234').trim() || 'http://localhost:1234',
        port: String(lmStudio.port || '1234').trim() || '1234',
        activeModel: String(lmStudio.activeModel || ''),
      },
      aider: {
        autoCommits: Boolean(aider.autoCommits),
        autoLint: Boolean(aider.autoLint),
        mapTokens: Math.max(256, Math.min(8192, Number(aider.mapTokens) || 1024)),
      },
      opencode: {
        model: String(opencode.model || ''),
        apiKey: String(opencode.apiKey || ''),
        useApiKey: opencode.useApiKey === true,
      },
    };
  };

const getAiAssistantSettings = () => sanitizeAiAssistantSettings(aiAssistantStore.store || {});

const setAiAssistantSettings = (payload = {}) => {
  const merged = sanitizeAiAssistantSettings({
    ...getAiAssistantSettings(),
    ...(payload || {}),
    roleMappings: {
      ...getAiAssistantSettings().roleMappings,
      ...(payload?.roleMappings || {}),
    },
    lmStudio: {
      ...getAiAssistantSettings().lmStudio,
      ...(payload?.lmStudio || {}),
    },
    aider: {
      ...getAiAssistantSettings().aider,
      ...(payload?.aider || {}),
    },
    opencode: {
      ...getAiAssistantSettings().opencode,
      ...(payload?.opencode || {}),
    },
  });

  aiAssistantStore.set(merged);
  return merged;
};

const getLocalModelState = async () => {
  const runtimePaths = getRuntimePaths(app);
  const candidates = [runtimePaths.modelsDir];
  const uniqueDirs = [...new Set(candidates.map((item) => path.resolve(item)))];

  await Promise.all(uniqueDirs.map(async (dirPath) => {
    await fsPromises.mkdir(dirPath, { recursive: true });
  }));

  const modelMap = new Map();
  for (const dirPath of uniqueDirs) {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.gguf')) {
        continue;
      }

      const localPath = path.join(dirPath, entry.name);
      const key = entry.name.toLowerCase();
      if (modelMap.has(key)) {
        continue;
      }

      modelMap.set(key, {
        id: entry.name,
        role: '',
        name: entry.name.replace(/\.gguf$/i, ''),
        fileName: entry.name,
        localPath,
        downloaded: true,
      });
    }
  }

  const models = Array.from(modelMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return {
    models,
    modelsDir: runtimePaths.modelsDir,
  };
};

const getLocalLlamaServers = async () => {
  const paths = getRuntimePaths(app);
  await fsPromises.mkdir(paths.llamaServerDir, { recursive: true });

  const activeManifestPath = path.join(paths.llamaServerDir, 'active.json');
  let active = null;
  if (fs.existsSync(activeManifestPath)) {
    try {
      active = JSON.parse(await fsPromises.readFile(activeManifestPath, 'utf-8'));
    } catch {
      active = null;
    }
  }

  const flavors = ['cpu', 'cuda', 'vulkan'];
  const versions = await Promise.all(
    flavors.map(async (flavor) => {
      const executablePath = await findFirstExecutable(paths.llamaServerDir, flavor);
      return {
        flavor,
        installed: Boolean(executablePath),
        executablePath: executablePath || '',
        active: String(active?.flavor || '').toLowerCase() === flavor,
      };
    }),
  );

  return {
    llamaServerDir: paths.llamaServerDir,
    active: active || null,
    versions,
  };
};

async function findFirstExecutable(startDir, flavor) {
  if (!fs.existsSync(startDir)) {
    return null;
  }

  const entries = await fsPromises.readdir(startDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'llama-server.exe') {
      if (!flavor || fullPath.toLowerCase().includes(flavor)) {
        return fullPath;
      }
    }
    if (entry.isDirectory()) {
      const nested = await findFirstExecutable(fullPath, flavor);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

const buildLmStudioModelsUrl = (input = {}) => {
  const rawBase = String(input?.endpointUrl || 'http://localhost:1234').trim() || 'http://localhost:1234';
  const port = String(input?.port || '').trim();
  const normalizedBase = /^https?:\/\//i.test(rawBase) ? rawBase : `http://${rawBase}`;
  const url = new URL(normalizedBase);

  if (port) {
    url.port = port;
  }

  url.pathname = '/v1/models';
  url.search = '';
  url.hash = '';

  return url.toString();
};

const storedLastWorkspace = String(workspaceHistoryStore.get('lastWorkspace', '')).trim();
const initialWorkspaceRoot = isExistingDirectory(storedLastWorkspace)
  ? path.resolve(storedLastWorkspace)
  : process.cwd();

const workspaceService = createWorkspaceService(initialWorkspaceRoot);
persistWorkspaceHistory(workspaceService.getWorkspaceRoot());
const runtimeBootstrapService = createRuntimeBootstrapService({
  app,
  getMainWindow: () => mainWindowRef,
});
const projectService = createProjectService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
});
const workspaceIndex = createWorkspaceIndex({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
});
const databaseService = createDatabaseService();
const llamaService = createLlamaService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
  getRuntimePaths: () => getRuntimePaths(app),
});
const projectMetadataService = createProjectMetadataService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
});
const codeSearchService = createCodeSearchService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
  workspaceIndex,
});
const patchService = createPatchService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
});
const validationService = createValidationService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
  getMainWindow: () => mainWindowRef,
});
const aiderService = createAiderService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
  getMainWindow: () => mainWindowRef,
});
const opencodeService = createOpencodeService({
  getMainWindow: () => mainWindowRef,
});
const mcpToolsService = createMcpToolsService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
});
const aiOrchestratorService = createAiOrchestratorService({
  getMainWindow: () => mainWindowRef,
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
  workspaceIndex,
  mcpToolsService,
  projectMetadataService,
  codeSearchService,
  patchService,
  validationService,
  agentMemoryDbPath: path.join(PAL_DATA_DIR, 'agent-memory.json'),
});

const readHardwareSnapshot = async () => {
  try {
    try {
      const smi = await si.nvidiaSmi();
      const firstGpu = Array.isArray(smi?.gpus) ? smi.gpus[0] : null;
      if (firstGpu) {
        const used = Number(firstGpu.memoryUsed ?? firstGpu.memory?.used ?? 0);
        const total = Number(firstGpu.memoryTotal ?? firstGpu.memory?.total ?? 0);
        if (total > 0) {
          return {
            vramUsed: used,
            vramTotal: total,
          };
        }
      }
    } catch {
      // Fall back to generic graphics info.
    }

    const graphics = await si.graphics();
    const controller =
      (graphics.controllers || []).find((item) => /nvidia/i.test(`${item.vendor || ''} ${item.model || ''}`)) ||
      (graphics.controllers || [])[0];

    const total = Number(controller?.vram ?? 0);
    const used = Number(controller?.memoryUsed ?? controller?.vramUsed ?? 0);
    return {
      vramUsed: used,
      vramTotal: total,
    };
  } catch {
    return {
      vramUsed: 0,
      vramTotal: 0,
    };
  }
};

const startHardwareMonitor = () => {
  if (hardwareMonitorTimer) {
    return;
  }

  let inFlight = false;
  const tick = async () => {
    if (inFlight) {
      return;
    }

    inFlight = true;
    try {
      hardwareSnapshot = await readHardwareSnapshot();
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('runtime:hardwareMetrics', hardwareSnapshot);
      }
    } finally {
      inFlight = false;
    }
  };

  void tick();
  hardwareMonitorTimer = setInterval(() => {
    void tick();
  }, 2000);
};

const stopHardwareMonitor = () => {
  if (hardwareMonitorTimer) {
    clearInterval(hardwareMonitorTimer);
    hardwareMonitorTimer = null;
  }
};

const buildTerminalId = () => `terminal-${terminalSessionCounter++}`;

const sendTerminalOutput = (terminalId, data) => {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('terminal-get-output', {
      terminalId,
      data: String(data || ''),
    });
  }
};

const killTerminalSession = (terminalId) => {
  const session = terminalSessions.get(terminalId);
  if (!session?.pty) {
    return;
  }

  try {
    session.pty.kill();
  } catch {
    // ignore shutdown errors
  }

  terminalSessions.delete(terminalId);
};

const resizeTerminalSession = (terminalId, cols = 100, rows = 30) => {
  const session = terminalSessions.get(terminalId);
  if (!session?.pty) {
    return { ok: false };
  }

  const width = Math.max(40, Number(cols || 100));
  const height = Math.max(12, Number(rows || 30));
  session.cols = width;
  session.rows = height;

  try {
    session.pty.resize(width, height);
  } catch {
    return { ok: false };
  }

  return {
    ok: true,
    cols: width,
    rows: height,
  };
};

const initializeTerminalShell = (workspaceRoot, options = {}) => {
  const terminalId = String(options.terminalId || buildTerminalId());
  killTerminalSession(terminalId);

  const cwd = workspaceRoot || workspaceService.getWorkspaceRoot();
  const cols = Math.max(40, Number(options.cols || 100));
  const rows = Math.max(12, Number(options.rows || 30));
  const shellCommand = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  const shellArgs = process.platform === 'win32' ? ['-NoLogo'] : [];

  const shellProcess = nodePty.spawn(shellCommand, shellArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: process.env,
  });

  terminalSessions.set(terminalId, {
    pty: shellProcess,
    cwd,
    cols,
    rows,
  });

  shellProcess.onData((data) => {
    sendTerminalOutput(terminalId, data);
  });

  shellProcess.onExit(({ exitCode, signal }) => {
    const shouldEmitExit = Boolean(signal) || (
      Number(exitCode || 0) !== 0 &&
      !(process.platform === 'win32' && Number(exitCode) === WINDOWS_CTRL_C_EXIT_CODE) &&
      !appIsQuitting
    );

    if (shouldEmitExit) {
      sendTerminalOutput(terminalId, `\r\n[terminal exited] code=${exitCode} signal=${signal ?? 'none'}\r\n`);
    }
    if (terminalSessions.get(terminalId)?.pty === shellProcess) {
      terminalSessions.delete(terminalId);
    }
  });

  return {
    ok: true,
    terminalId,
    cwd,
  };
};

const shouldBlockDevShortcut = (input) => {
  if (!input) {
    return false;
  }

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  const acceleratorPressed = Boolean(input.control || input.meta);

  return (
    key === 'f12' ||
    code === 'f12' ||
    key === 'f5' ||
    code === 'f5' ||
    (acceleratorPressed && input.shift && key === 'i') ||
    (acceleratorPressed && input.shift && key === 'j') ||
    (acceleratorPressed && input.shift && key === 'c') ||
    (acceleratorPressed && key === 'r')
  );
};

const ensureChatSessionsDirectory = () => {
  fs.mkdirSync(CHAT_SESSIONS_DIR, { recursive: true });
};

const resolveChatSessionFilePath = (sessionId) => {
  const safeSessionId = String(sessionId || 'default-session')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  const fileName = `${safeSessionId || 'default-session'}.json`;
  return path.join(CHAT_SESSIONS_DIR, fileName);
};

const sanitizeChatMessages = (input) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((item) => ({
    id: String(item?.id || ''),
    role: String(item?.role || 'assistant'),
    text: String(item?.text || ''),
    status: String(item?.status || 'done'),
  }));
};

const sanitizeAppliedActionIds = (input) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(input.map((item) => String(item || '').trim()).filter(Boolean))];
};

const sanitizeChatSessionState = (input) => {
  if (Array.isArray(input)) {
    return {
      messages: sanitizeChatMessages(input),
      appliedActionIds: [],
    };
  }

  const session = input && typeof input === 'object' ? input : {};
  return {
    messages: sanitizeChatMessages(session.messages),
    appliedActionIds: sanitizeAppliedActionIds(session.appliedActionIds),
  };
};

const normalizeWorkspaceFilePath = (inputPath) => {
  const relativePath = String(inputPath || '').trim();
  if (!relativePath) {
    throw new Error('A workspace-relative path is required.');
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error('Absolute paths are not allowed.');
  }

  const root = workspaceService.getWorkspaceRoot();
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, relativePath);
  const rootCheck = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
  const targetCheck = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
  if (targetCheck !== rootCheck && !targetCheck.startsWith(`${rootCheck}${path.sep}`)) {
    throw new Error('Path is outside workspace root.');
  }

  return {
    root: resolvedRoot,
    absolutePath: resolvedTarget,
    relativePath: path.relative(resolvedRoot, resolvedTarget).replace(/\\/g, '/'),
  };
};

const safeResolve = (...paths) => {
  try {
    return path.resolve(...paths);
  } catch (error) {
    if (error?.code === 'EPERM' || String(error?.message || '').includes('EPERM')) {
      // Windows realpath EPERM — fall back to string-joining without symlink resolution
      return paths.reduce((acc, p) => {
        if (!p) return acc;
        if (path.isAbsolute(p)) return p;
        return acc ? `${acc}${path.sep}${p}` : p;
      }, '');
    }
    throw error;
  }
};

const normalizeWorkspaceNodePath = (inputPath) => {
  const candidatePath = String(inputPath || '').trim();
  if (!candidatePath) {
    throw new Error('A workspace path is required.');
  }

  const root = workspaceService.getWorkspaceRoot();
  const resolvedRoot = safeResolve(root);
  const resolvedTarget = path.isAbsolute(candidatePath)
    ? safeResolve(candidatePath)
    : safeResolve(resolvedRoot, candidatePath);

  const rootCheck = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
  const targetCheck = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget;
  if (targetCheck !== rootCheck && !targetCheck.startsWith(`${rootCheck}${path.sep}`)) {
    throw new Error('Path is outside workspace root.');
  }

  return {
    root: resolvedRoot,
    absolutePath: resolvedTarget,
    relativePath: path.relative(resolvedRoot, resolvedTarget).replace(/\\/g, '/'),
  };
};

const normalizeWorkspaceError = (error, fallbackMessage) => {
  const code = String(error?.code || 'WORKSPACE_IO_ERROR');
  return {
    code,
    message: String(error?.message || fallbackMessage || 'Workspace operation failed.'),
  };
};

const normalizePortablePath = (value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();

const findWorkspaceFileByHint = async (inputPath) => {
  const hintPath = normalizePortablePath(inputPath).replace(/^\/+/, '');
  if (!hintPath) {
    return '';
  }

  const basename = path.posix.basename(hintPath).toLowerCase();
  if (!basename) {
    return '';
  }

  const root = workspaceService.getWorkspaceRoot();
  const rootAbsolute = path.resolve(root);
  const queue = [rootAbsolute];
  const candidates = [];
  let visited = 0;

  while (queue.length && visited < WORKSPACE_MAX_TREE_NODES) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    let entries = [];
    try {
      entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visited += 1;
      if (visited > WORKSPACE_MAX_TREE_NODES) {
        break;
      }

      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (WORKSPACE_IGNORED_NAMES.has(entry.name)) {
          continue;
        }
        queue.push(entryPath);
        continue;
      }

      if (!entry.isFile() || entry.name.toLowerCase() !== basename) {
        continue;
      }

      const relativePath = normalizePortablePath(path.relative(rootAbsolute, entryPath));
      if (relativePath) {
        candidates.push(relativePath);
      }
    }
  }

  if (!candidates.length) {
    return '';
  }

  const hintSegments = hintPath.toLowerCase().split('/').filter(Boolean);
  const scored = candidates
    .map((candidatePath) => {
      const lowerCandidate = candidatePath.toLowerCase();
      let score = 0;

      if (lowerCandidate === hintPath.toLowerCase()) {
        score += 2000;
      }
      if (lowerCandidate.endsWith(hintPath.toLowerCase())) {
        score += 1000;
      }
      if (lowerCandidate.includes(hintPath.toLowerCase())) {
        score += 600;
      }

      for (const segment of hintSegments) {
        if (lowerCandidate.includes(`/${segment}/`) || lowerCandidate.endsWith(`/${segment}`) || lowerCandidate.startsWith(`${segment}/`)) {
          score += 120;
        }
      }

      score -= lowerCandidate.split('/').length;

      return {
        path: candidatePath,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.path || '';
};

const sendAgentStepUpdate = (payload) => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return;
  }

  mainWindowRef.webContents.send('agent:step-update', {
    type: String(payload?.type || 'read'),
    status: String(payload?.status || 'pending'),
    target: String(payload?.target || ''),
    details: String(payload?.details || ''),
    traceId: String(payload?.traceId || ''),
  });
};

const countTextLines = (text) => {
  const normalized = String(text || '');
  if (!normalized) {
    return 0;
  }

  return normalized.split(/\r\n|\r|\n/).length;
};

const safeReadWorkspaceFile = async (inputPath, traceId = '') => {
  const initialHint = normalizePortablePath(inputPath);

  const readTarget = async (target, details = 'Reading workspace file contents.') => {
    sendAgentStepUpdate({
      type: 'read',
      status: 'pending',
      target: target.relativePath,
      details,
      traceId,
    });

    const stat = await fsPromises.stat(target.absolutePath);
    if (!stat.isFile()) {
      return {
        ok: false,
        error: {
          code: 'NOT_A_FILE',
          message: 'Selected path is not a file.',
        },
      };
    }

    const content = await fsPromises.readFile(target.absolutePath, 'utf-8');
    const lineCount = countTextLines(content);
    sendAgentStepUpdate({
      type: 'read',
      status: 'success',
      target: target.relativePath,
      details: `lines 1 to ${Math.max(1, lineCount)}`,
      traceId,
    });

    return {
      ok: true,
      path: target.relativePath,
      content,
    };
  };

  try {
    const target = normalizeWorkspaceFilePath(inputPath);
    return await readTarget(target);
  } catch (error) {
    const canRetryLookup = String(error?.code || '').toUpperCase() === 'ENOENT' || /no such file or directory/i.test(String(error?.message || ''));
    if (canRetryLookup && initialHint) {
      try {
        const recoveredPath = await findWorkspaceFileByHint(initialHint);
        if (recoveredPath) {
          const recoveredTarget = normalizeWorkspaceFilePath(recoveredPath);
          return await readTarget(recoveredTarget, `Resolved missing path hint "${initialHint}".`);
        }
      } catch {
        // Ignore path recovery failures and return original error below.
      }
    }

    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to read workspace file.'),
    };
  }
};

const saveCurrentFileToDisk = ({ filePath, content, traceId = '' }) => {
  const targetPath = String(filePath || '').trim();
  if (!targetPath) {
    throw new Error('A file path is required.');
  }

  const resolvedPath = path.resolve(targetPath);
  const previousContent = fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, 'utf-8') : '';
  sendAgentStepUpdate({
    type: 'write',
    status: 'pending',
    target: resolvedPath,
    details: 'Writing file to disk.',
    traceId,
  });

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const nextContent = String(content || '');
  fs.writeFileSync(resolvedPath, nextContent, 'utf-8');

  const previousLines = countTextLines(previousContent);
  const nextLines = countTextLines(nextContent);
  sendAgentStepUpdate({
    type: 'write',
    status: 'success',
    target: resolvedPath,
    details: `+${Math.max(0, nextLines - previousLines)} -${Math.max(0, previousLines - nextLines)} lines`,
    traceId,
  });

  return {
    ok: true,
    filePath: resolvedPath,
  };
};

const writeWorkspaceFileAtomic = async ({ inputPath, text, backup = true, traceId = '' }) => {
  try {
    const target = normalizeWorkspaceFilePath(inputPath);
    const payload = typeof text === 'string' ? text : String(text || '');
    const targetDir = path.dirname(target.absolutePath);
    await fsPromises.mkdir(targetDir, { recursive: true });

    const previousContent = fs.existsSync(target.absolutePath) ? await fsPromises.readFile(target.absolutePath, 'utf-8') : '';
    sendAgentStepUpdate({
      type: 'write',
      status: 'pending',
      target: target.relativePath,
      details: 'Updating workspace file.',
      traceId,
    });

    let backupPath = '';
    if (backup && fs.existsSync(target.absolutePath)) {
      backupPath = `${target.absolutePath}.bak.${Date.now()}`;
      await fsPromises.copyFile(target.absolutePath, backupPath);
    }

    const tempPath = `${target.absolutePath}.tmp.${process.pid}.${Date.now()}`;
    await fsPromises.writeFile(tempPath, payload, 'utf-8');

    try {
      await fsPromises.rename(tempPath, target.absolutePath);
    } catch (renameError) {
      if (renameError?.code && renameError.code !== 'EPERM' && renameError.code !== 'EEXIST') {
        throw renameError;
      }
      if (fs.existsSync(target.absolutePath)) {
        await fsPromises.unlink(target.absolutePath);
      }
      await fsPromises.rename(tempPath, target.absolutePath);
    }

    const previousLines = countTextLines(previousContent);
    const nextLines = countTextLines(payload);
    sendAgentStepUpdate({
      type: 'write',
      status: 'success',
      target: target.relativePath,
      details: `+${Math.max(0, nextLines - previousLines)} -${Math.max(0, previousLines - nextLines)} lines`,
      traceId,
    });

    return {
      ok: true,
      path: target.relativePath,
      backupPath: backupPath ? path.relative(target.root, backupPath).replace(/\\/g, '/') : '',
      bytes: Buffer.byteLength(payload, 'utf8'),
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to write workspace file.'),
    };
  }
};

const ensureUniqueDestinationPath = async (candidateAbsolutePath) => {
  if (!fs.existsSync(candidateAbsolutePath)) {
    return candidateAbsolutePath;
  }

  const parentDir = path.dirname(candidateAbsolutePath);
  const ext = path.extname(candidateAbsolutePath);
  const base = path.basename(candidateAbsolutePath, ext);
  let counter = 1;

  while (counter < 1000) {
    const suffix = counter === 1 ? ' copy' : ` copy ${counter}`;
    const nextCandidate = path.join(parentDir, `${base}${suffix}${ext}`);
    if (!fs.existsSync(nextCandidate)) {
      return nextCandidate;
    }
    counter += 1;
  }

  throw new Error('Unable to create a unique destination path.');
};

const deleteWorkspaceNode = async ({ inputPath, traceId = '' }) => {
  try {
    const target = normalizeWorkspaceNodePath(inputPath);
    const stat = fs.statSync(target.absolutePath);

    sendAgentStepUpdate({
      type: 'delete',
      status: 'pending',
      target: target.relativePath,
      details: 'Deleting workspace node.',
      traceId,
    });

    fs.removeSync(target.absolutePath);

    sendAgentStepUpdate({
      type: 'delete',
      status: 'success',
      target: target.relativePath,
      details: stat.isDirectory() ? 'Directory removed.' : 'File removed.',
      traceId,
    });

    return {
      ok: true,
      path: target.relativePath,
      isDirectory: stat.isDirectory(),
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to delete workspace path.'),
    };
  }
};

const renameWorkspaceNode = async ({ inputPath, nextName, traceId = '' }) => {
  try {
    const normalizedName = String(nextName || '').trim();
    if (!normalizedName || normalizedName === '.' || normalizedName === '..' || /[\\/]/.test(normalizedName)) {
      throw new Error('A valid file or folder name is required.');
    }

    const target = normalizeWorkspaceNodePath(inputPath);
    const currentStat = await fsPromises.stat(target.absolutePath);
    const nextAbsolutePath = path.join(path.dirname(target.absolutePath), normalizedName);
    const nextTarget = normalizeWorkspaceNodePath(nextAbsolutePath);

    if (target.absolutePath === nextTarget.absolutePath) {
      return {
        ok: true,
        fromPath: target.relativePath,
        path: nextTarget.relativePath,
        isDirectory: currentStat.isDirectory(),
      };
    }

    if (fs.existsSync(nextTarget.absolutePath)) {
      throw new Error('A file or folder with that name already exists.');
    }

    sendAgentStepUpdate({
      type: 'write',
      status: 'pending',
      target: target.relativePath,
      details: `Renaming to ${normalizedName}.`,
      traceId,
    });

    fs.moveSync(target.absolutePath, nextTarget.absolutePath, { overwrite: false });

    sendAgentStepUpdate({
      type: 'write',
      status: 'success',
      target: nextTarget.relativePath,
      details: 'Rename complete.',
      traceId,
    });

    return {
      ok: true,
      fromPath: target.relativePath,
      path: nextTarget.relativePath,
      isDirectory: currentStat.isDirectory(),
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to rename workspace path.'),
    };
  }
};

const pasteWorkspaceNode = async ({ sourcePath, targetPath, mode = 'copy', traceId = '' }) => {
  try {
    const normalizedMode = String(mode || 'copy').toLowerCase() === 'cut' ? 'cut' : 'copy';
    const source = normalizeWorkspaceNodePath(sourcePath);
    const sourceStat = await fsPromises.stat(source.absolutePath);
    const targetCandidate = normalizeWorkspaceNodePath(targetPath);
    const targetStat = await fsPromises.stat(targetCandidate.absolutePath);
    const targetDirectoryPath = targetStat.isDirectory()
      ? targetCandidate.absolutePath
      : path.dirname(targetCandidate.absolutePath);
    const targetDirectory = normalizeWorkspaceNodePath(targetDirectoryPath);

    if (source.absolutePath === targetDirectory.absolutePath) {
      throw new Error('Cannot paste item into itself.');
    }

    if (sourceStat.isDirectory() && targetDirectory.absolutePath.startsWith(`${source.absolutePath}${path.sep}`)) {
      throw new Error('Cannot paste a directory into one of its descendants.');
    }

    const initialDestination = path.join(targetDirectory.absolutePath, path.basename(source.absolutePath));
    const destinationAbsolutePath = await ensureUniqueDestinationPath(initialDestination);
    const destination = normalizeWorkspaceNodePath(destinationAbsolutePath);

    sendAgentStepUpdate({
      type: normalizedMode === 'cut' ? 'write' : 'search',
      status: 'pending',
      target: source.relativePath,
      details: normalizedMode === 'cut' ? `Moving to ${destination.relativePath}.` : `Copying to ${destination.relativePath}.`,
      traceId,
    });

    if (normalizedMode === 'cut') {
      fs.moveSync(source.absolutePath, destination.absolutePath, { overwrite: false });
    } else if (sourceStat.isDirectory()) {
      fs.copySync(source.absolutePath, destination.absolutePath, { overwrite: false, errorOnExist: true });
    } else {
      fs.copySync(source.absolutePath, destination.absolutePath, { overwrite: false, errorOnExist: true });
    }

    sendAgentStepUpdate({
      type: normalizedMode === 'cut' ? 'write' : 'search',
      status: 'success',
      target: destination.relativePath,
      details: normalizedMode === 'cut' ? 'Move complete.' : 'Copy complete.',
      traceId,
    });

    return {
      ok: true,
      path: destination.relativePath,
      mode: normalizedMode,
      sourcePath: source.relativePath,
      isDirectory: sourceStat.isDirectory(),
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to paste workspace path.'),
    };
  }
};

const createWorkspaceNode = async ({ parentPath, name, type = 'file', traceId = '' }) => {
  try {
    const normalizedType = String(type || 'file').toLowerCase() === 'folder' ? 'folder' : 'file';
    const normalizedName = String(name || '').trim();
    if (!normalizedName || normalizedName === '.' || normalizedName === '..' || /[\\/]/.test(normalizedName)) {
      throw new Error('A valid file or folder name is required.');
    }

    const parentCandidate = String(parentPath || '').trim();
    const parent = normalizeWorkspaceNodePath(parentCandidate || workspaceService.getWorkspaceRoot());
    const parentStat = await fsPromises.stat(parent.absolutePath);
    if (!parentStat.isDirectory()) {
      throw new Error('Parent path must be a directory.');
    }

    const targetAbsolutePath = path.join(parent.absolutePath, normalizedName);
    const target = normalizeWorkspaceNodePath(targetAbsolutePath);
    if (fs.existsSync(target.absolutePath)) {
      throw new Error('A file or folder with that name already exists.');
    }

    sendAgentStepUpdate({
      type: 'write',
      status: 'pending',
      target: target.relativePath,
      details: normalizedType === 'folder' ? 'Creating folder.' : 'Creating file.',
      traceId,
    });

    if (normalizedType === 'folder') {
      fs.ensureDirSync(target.absolutePath);
    } else {
      fs.ensureFileSync(target.absolutePath);
    }

    sendAgentStepUpdate({
      type: 'write',
      status: 'success',
      target: target.relativePath,
      details: normalizedType === 'folder' ? 'Folder created.' : 'File created.',
      traceId,
    });

    return {
      ok: true,
      path: target.relativePath,
      isDirectory: normalizedType === 'folder',
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to create workspace node.'),
    };
  }
};

const revealWorkspacePath = async ({ inputPath }) => {
  try {
    const target = normalizeWorkspaceNodePath(inputPath || workspaceService.getWorkspaceRoot());
    const stat = await fsPromises.stat(target.absolutePath);
    if (stat.isDirectory()) {
      await shell.openPath(target.absolutePath);
    } else {
      shell.showItemInFolder(target.absolutePath);
    }

    return {
      ok: true,
      path: target.relativePath,
      isDirectory: stat.isDirectory(),
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to reveal workspace path.'),
    };
  }
};

const applyWorkspacePatches = (sourceText, patches) => {
  if (!Array.isArray(patches) || !patches.length) {
    throw new Error('patches must be a non-empty array.');
  }

  let working = String(sourceText || '');
  let appliedCount = 0;

  for (const patchEntry of patches) {
    const find = typeof patchEntry?.find === 'string' ? patchEntry.find : null;
    const replace = typeof patchEntry?.replace === 'string' ? patchEntry.replace : '';
    const replaceAll = Boolean(patchEntry?.replaceAll);

    if (find !== null) {
      if (!find.length) {
        continue;
      }
      if (!working.includes(find)) {
        continue;
      }

      working = replaceAll
        ? working.split(find).join(replace)
        : working.replace(find, replace);
      appliedCount += 1;
      continue;
    }

    const startLine = Number(patchEntry?.startLine);
    const endLine = Number(patchEntry?.endLine || startLine);
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
      continue;
    }

    const lines = working.split('\n');
    const lineStartIdx = startLine - 1;
    const lineEndIdx = Math.min(lines.length, endLine);
    const replacementLines = String(patchEntry?.text || '').split('\n');

    lines.splice(lineStartIdx, Math.max(0, lineEndIdx - lineStartIdx), ...replacementLines);
    working = lines.join('\n');
    appliedCount += 1;
  }

  if (appliedCount < 1) {
    throw new Error('No patch operations were applied.');
  }

  return {
    content: working,
    appliedCount,
  };
};

const listWorkspaceFilesTree = async (traceId = '') => {
  try {
    const workspaceRoot = workspaceService.getWorkspaceRoot();
    const resolvedRoot = path.resolve(workspaceRoot);
    let nodeCounter = 0;

    sendAgentStepUpdate({
      type: 'search',
      status: 'pending',
      target: resolvedRoot,
      details: 'Enumerating workspace files.',
      traceId,
    });

    const walk = async (dirPath) => {
      if (nodeCounter > WORKSPACE_MAX_TREE_NODES) {
        return [];
      }

      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
      const filtered = entries
        .filter((entry) => !WORKSPACE_IGNORED_NAMES.has(entry.name))
        .sort((a, b) => {
          const aDir = a.isDirectory() ? 0 : 1;
          const bDir = b.isDirectory() ? 0 : 1;
          if (aDir !== bDir) {
            return aDir - bDir;
          }
          return a.name.localeCompare(b.name);
        });

      const nodes = [];
      for (const entry of filtered) {
        if (nodeCounter > WORKSPACE_MAX_TREE_NODES) {
          break;
        }

        const absolutePath = path.join(dirPath, entry.name);
        const relativePath = path.relative(resolvedRoot, absolutePath).replace(/\\/g, '/');
        const isDirectory = entry.isDirectory();
        const isSymlink = entry.isSymbolicLink();

        nodeCounter += 1;
        if (isSymlink) {
          continue;
        }

        if (isDirectory) {
          nodes.push({
            name: entry.name,
            path: relativePath,
            isDirectory: true,
            children: await walk(absolutePath),
          });
        } else {
          nodes.push({
            name: entry.name,
            path: relativePath,
            isDirectory: false,
          });
        }
      }

      return nodes;
    };

    const tree = await walk(resolvedRoot);
    sendAgentStepUpdate({
      type: 'search',
      status: 'success',
      target: resolvedRoot,
      details: `found ${nodeCounter} entries`,
      traceId,
    });

    return {
      ok: true,
      root: resolvedRoot,
      tree,
      truncated: nodeCounter > WORKSPACE_MAX_TREE_NODES,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to list workspace files.'),
    };
  }
};

const listWorkspaceRelativeFiles = async (resolvedRoot) => {
  const files = [];

  const walk = async (dirPath) => {
    if (files.length > WORKSPACE_MAX_TREE_NODES) {
      return;
    }

    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (WORKSPACE_IGNORED_NAMES.has(entry.name) || entry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(resolvedRoot, absolutePath).replace(/\\/g, '/'));
      }

      if (files.length > WORKSPACE_MAX_TREE_NODES) {
        break;
      }
    }
  };

  await walk(resolvedRoot);
  return files;
};

const searchWorkspaceText = async ({ query, isRegex = false, maxResults = 60, traceId = '' } = {}) => {
  try {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      throw new Error('Search query is required.');
    }

    const resolvedRoot = path.resolve(workspaceService.getWorkspaceRoot());
    const boundedMaxResults = Math.max(1, Math.min(WORKSPACE_SEARCH_MAX_RESULTS, Number(maxResults) || 60));
    const matcher = isRegex ? new RegExp(normalizedQuery, 'i') : null;
    const queryLower = normalizedQuery.toLowerCase();

    sendAgentStepUpdate({
      type: 'search',
      status: 'pending',
      target: normalizedQuery,
      details: 'Searching workspace text.',
      traceId,
    });

    const allFiles = await listWorkspaceRelativeFiles(resolvedRoot);
    const matches = [];

    for (const relativePath of allFiles) {
      if (matches.length >= boundedMaxResults) {
        break;
      }

      const extension = path.extname(relativePath).toLowerCase();
      if (SEARCH_EXCLUDED_EXTENSIONS.has(extension)) {
        continue;
      }

      const absolutePath = path.join(resolvedRoot, relativePath);
      let content = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        content = await fsPromises.readFile(absolutePath, 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (matches.length >= boundedMaxResults) {
          break;
        }

        const line = lines[lineIndex];
        const didMatch = matcher ? matcher.test(line) : line.toLowerCase().includes(queryLower);
        if (!didMatch) {
          continue;
        }

        matches.push({
          path: relativePath,
          lineNumber: lineIndex + 1,
          line: line.slice(0, 400),
        });
      }
    }

    sendAgentStepUpdate({
      type: 'search',
      status: 'success',
      target: normalizedQuery,
      details: `Found ${matches.length} matches.`,
      traceId,
    });

    return {
      ok: true,
      query: normalizedQuery,
      isRegex: Boolean(isRegex),
      resultCount: matches.length,
      matches,
      truncated: matches.length >= boundedMaxResults,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to search workspace text.'),
    };
  }
};

const searchWorkspacePaths = async ({ pattern, maxResults = 60, traceId = '' } = {}) => {
  try {
    const normalizedPattern = String(pattern || '').trim();
    if (!normalizedPattern) {
      throw new Error('Search pattern is required.');
    }

    const resolvedRoot = path.resolve(workspaceService.getWorkspaceRoot());
    const boundedMaxResults = Math.max(1, Math.min(200, Number(maxResults) || 60));

    sendAgentStepUpdate({
      type: 'search',
      status: 'pending',
      target: normalizedPattern,
      details: 'Searching workspace paths.',
      traceId,
    });

    const allFiles = await listWorkspaceRelativeFiles(resolvedRoot);
    const matches = [];

    for (const relativePath of allFiles) {
      if (matches.length >= boundedMaxResults) break;

      const fileName = path.basename(relativePath);
      if (simpleGlobMatch(normalizedPattern, relativePath) || simpleGlobMatch(normalizedPattern, fileName)) {
        matches.push({ path: relativePath });
      }
    }

    sendAgentStepUpdate({
      type: 'search',
      status: 'success',
      target: normalizedPattern,
      details: `Found ${matches.length} matching paths.`,
      traceId,
    });

    return {
      ok: true,
      pattern: normalizedPattern,
      resultCount: matches.length,
      matches,
      truncated: matches.length >= boundedMaxResults,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to search workspace paths.'),
    };
  }
};

const toSyntaxIssue = (relativePath, error) => {
  const message = String(error?.message || error || 'Syntax error');
  const lineNumber = Number(error?.lineNumber || error?.line || 0) || null;
  const columnNumber = Number(error?.columnNumber || error?.column || 0) || null;

  return {
    path: relativePath,
    lineNumber,
    columnNumber,
    severity: 'error',
    code: 'syntax',
    message,
  };
};

const collectWorkspaceDiagnostics = async ({ inputPath = '', traceId = '' } = {}) => {
  try {
    const candidatePath = String(inputPath || '').trim();
    const resolvedRoot = path.resolve(workspaceService.getWorkspaceRoot());

    sendAgentStepUpdate({
      type: 'search',
      status: 'pending',
      target: candidatePath || resolvedRoot,
      details: 'Collecting syntax diagnostics.',
      traceId,
    });

    let relativeTargets = [];
    if (candidatePath && candidatePath !== '.') {
      const normalized = normalizeWorkspaceNodePath(candidatePath);
      const stat = await fsPromises.stat(normalized.absolutePath);
      if (stat.isDirectory()) {
        relativeTargets = (await listWorkspaceRelativeFiles(normalized.absolutePath))
          .map((item) => path.relative(resolvedRoot, path.join(normalized.absolutePath, item)).replace(/\\/g, '/'));
      } else {
        relativeTargets = [normalized.relativePath];
      }
    } else {
      relativeTargets = await listWorkspaceRelativeFiles(resolvedRoot);
    }

    const diagnosticsTargets = relativeTargets
      .filter((relativePath) => {
        const ext = path.extname(relativePath).toLowerCase();
        return ext === '.json' || ext === '.js' || ext === '.mjs' || ext === '.cjs';
      })
      .slice(0, WORKSPACE_DIAGNOSTICS_MAX_FILES);

    const errors = [];
    for (const relativePath of diagnosticsTargets) {
      if (errors.length >= WORKSPACE_DIAGNOSTICS_MAX_ISSUES) {
        break;
      }

      const absolutePath = path.join(resolvedRoot, relativePath);
      const ext = path.extname(relativePath).toLowerCase();

      let content = '';
      try {
        // eslint-disable-next-line no-await-in-loop
        content = await fsPromises.readFile(absolutePath, 'utf-8');
      } catch {
        continue;
      }

      try {
        if (ext === '.json') {
          JSON.parse(content);
        } else if (ext === '.cjs') {
          // eslint-disable-next-line no-new
          new vm.Script(content, { filename: absolutePath });
        } else {
          // eslint-disable-next-line no-new
          new vm.SourceTextModule(content, { identifier: absolutePath });
        }
      } catch (error) {
        errors.push(toSyntaxIssue(relativePath, error));
      }
    }

    sendAgentStepUpdate({
      type: 'search',
      status: 'success',
      target: candidatePath || resolvedRoot,
      details: `Collected ${errors.length} diagnostics.`,
      traceId,
    });

    return {
      ok: true,
      path: candidatePath || '.',
      scannedFiles: diagnosticsTargets.length,
      errorCount: errors.length,
      errors,
      truncated: errors.length >= WORKSPACE_DIAGNOSTICS_MAX_ISSUES,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to collect workspace diagnostics.'),
    };
  }
};

const listWorkspaceDirectoryPaged = async ({ inputPath = '.', page = 1, pageSize = 200, traceId = '' } = {}) => {
  try {
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedPageSize = Math.max(20, Math.min(500, Number(pageSize) || 200));
    const target = normalizeWorkspaceNodePath(inputPath || '.');
    const stat = await fsPromises.stat(target.absolutePath);

    if (!stat.isDirectory()) {
      throw new Error('Target path must be a directory.');
    }

    sendAgentStepUpdate({
      type: 'search',
      status: 'pending',
      target: target.relativePath || '.',
      details: `Listing directory page ${normalizedPage}.`,
      traceId,
    });

    const entries = await fsPromises.readdir(target.absolutePath, { withFileTypes: true });
    const filtered = entries
      .filter((entry) => !WORKSPACE_IGNORED_NAMES.has(entry.name))
      .sort((a, b) => {
        const aDir = a.isDirectory() ? 0 : 1;
        const bDir = b.isDirectory() ? 0 : 1;
        if (aDir !== bDir) {
          return aDir - bDir;
        }
        return a.name.localeCompare(b.name);
      });

    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
    const safePage = Math.min(normalizedPage, totalPages);
    const startIdx = (safePage - 1) * normalizedPageSize;
    const endIdx = Math.min(startIdx + normalizedPageSize, totalItems);
    const pageItems = filtered.slice(startIdx, endIdx).map((entry) => {
      const absolutePath = path.join(target.absolutePath, entry.name);
      const relativePath = path.relative(workspaceService.getWorkspaceRoot(), absolutePath).replace(/\\/g, '/');
      return {
        name: entry.name,
        path: relativePath || '.',
        isDirectory: entry.isDirectory(),
      };
    });

    sendAgentStepUpdate({
      type: 'search',
      status: 'success',
      target: target.relativePath || '.',
      details: `Listed ${pageItems.length} items from page ${safePage}/${totalPages}.`,
      traceId,
    });

    return {
      ok: true,
      path: target.relativePath || '.',
      page: safePage,
      pageSize: normalizedPageSize,
      totalItems,
      totalPages,
      items: pageItems,
      hasNextPage: safePage < totalPages,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeWorkspaceError(error, 'Unable to list directory page.'),
    };
  }
};

const resolveAppShortcutId = (input) => {
  if (!input) {
    return null;
  }

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  const acceleratorPressed = Boolean(input.control || input.meta);

  if (!acceleratorPressed) {
    return null;
  }

  if (key === '`' || code === 'backquote') {
    return 'toggle-terminal';
  }

  if (input.alt && key === 'i') {
    return 'toggle-chat-panel';
  }

  return null;
};

const registerIpcHandlers = () => {
  const updateWorkspaceRoot = (candidatePath) => {
    const previous = workspaceService.getWorkspaceRoot();
    const next = workspaceService.setWorkspaceRoot(candidatePath);

    persistWorkspaceHistory(next);
    startWatchingWorkspace(mainWindowRef, next);

    workspaceIndex.markDirty();
    void workspaceIndex.ensureFresh();
    if (codeSearchService?.markDirty) codeSearchService.markDirty();

    if (previous !== next) {
      const existingSessionIds = Array.from(terminalSessions.keys());
      for (const terminalId of existingSessionIds) {
        initializeTerminalShell(next, { terminalId });
      }
    }

    return {
      previous,
      next,
      changed: previous !== next,
    };
  };

  ipcMain.handle('runtime:getWorkspaceRoot', async () => ({
    cwd: workspaceService.getWorkspaceRoot(),
  }));
  ipcMain.handle('runtime:setWorkspaceRoot', async (_event, payload) => {
    const updated = updateWorkspaceRoot(payload?.cwd);

    return {
      cwd: updated.next,
    };
  });
  ipcMain.handle('runtime:getRecentWorkspaces', async () => ({
    items: getRecentWorkspaces(),
  }));
  ipcMain.handle('runtime:clearRecentWorkspaces', async () => {
    workspaceHistoryStore.set('recentWorkspaces', []);
    return {
      items: [],
    };
  });
  ipcMain.handle('runtime:openWorkspaceFolder', async (_event, payload) => {
    const targetPath = String(payload?.cwd || '').trim();
    if (!targetPath || !isExistingDirectory(targetPath)) {
      return {
        ok: false,
        cwd: workspaceService.getWorkspaceRoot(),
        error: 'Selected folder does not exist.',
      };
    }

    const updated = updateWorkspaceRoot(targetPath);
    return {
      ok: true,
      cwd: updated.next,
    };
  });
  ipcMain.handle('runtime:pickWorkspaceFolder', async () => {
    const parentWindow = BrowserWindow.getFocusedWindow() || mainWindowRef || undefined;
    const currentRoot = workspaceService.getWorkspaceRoot();

    const selection = await dialog.showOpenDialog(parentWindow, {
      title: 'Select Workspace Folder',
      defaultPath: currentRoot,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (selection.canceled || !Array.isArray(selection.filePaths) || !selection.filePaths.length) {
      return {
        cancelled: true,
        cwd: currentRoot,
      };
    }

    const updated = updateWorkspaceRoot(selection.filePaths[0]);

    return {
      cancelled: false,
      cwd: updated.next,
    };
  });
  ipcMain.handle('runtime:bootstrap', runtimeBootstrapService.ensureRuntimeAssets);
  ipcMain.handle('runtime:cancelBootstrap', runtimeBootstrapService.cancelRuntimeBootstrap);
  ipcMain.handle('workspace:copy-text', async (_event, payload) => {
    const text = String(payload?.text || '');
    clipboard.writeText(text);
    return {
      ok: true,
      text,
    };
  });
  ipcMain.handle('workspace:read-file', async (_event, payload) =>
    safeReadWorkspaceFile(payload?.path, payload?.traceId),
  );
  ipcMain.handle('workspace:delete-file', async (_event, payload) =>
    deleteWorkspaceNode({
      inputPath: payload?.path,
      traceId: payload?.traceId,
    }),
  );
  ipcMain.handle('workspace:rename-path', async (_event, payload) =>
    renameWorkspaceNode({
      inputPath: payload?.path,
      nextName: payload?.name,
      traceId: payload?.traceId,
    }),
  );
  ipcMain.handle('workspace:paste-path', async (_event, payload) =>
    pasteWorkspaceNode({
      sourcePath: payload?.sourcePath,
      targetPath: payload?.targetPath,
      mode: payload?.mode,
      traceId: payload?.traceId,
    }),
  );
  ipcMain.handle('workspace:create-path', async (_event, payload) =>
    createWorkspaceNode({
      parentPath: payload?.parentPath,
      name: payload?.name,
      type: payload?.type,
      traceId: payload?.traceId,
    }),
  );
  ipcMain.handle('workspace:reveal-path', async (_event, payload) =>
    revealWorkspacePath({
      inputPath: payload?.path,
    }),
  );
  ipcMain.handle('workspace:write-file', async (_event, payload) =>
    writeWorkspaceFileAtomic({
      inputPath: payload?.path,
      text: payload?.content,
      backup: payload?.backup !== false,
      traceId: payload?.traceId,
    }),
  );
  ipcMain.handle('workspace:save-current-file', async (_event, payload) => {
    try {
      return saveCurrentFileToDisk({
        filePath: payload?.filePath,
        content: payload?.content,
        traceId: payload?.traceId,
      });
    } catch (error) {
      return {
        ok: false,
        error: normalizeWorkspaceError(error, 'Unable to save current file.'),
      };
    }
  });
  ipcMain.handle('workspace:patch-file', async (_event, payload) => {
    const current = await safeReadWorkspaceFile(payload?.path);
    if (!current.ok) {
      return current;
    }

    try {
      const patched = applyWorkspacePatches(current.content, payload?.patches);
      const writeResult = await writeWorkspaceFileAtomic({
        inputPath: payload?.path,
        text: patched.content,
        backup: payload?.backup !== false,
        traceId: payload?.traceId,
      });

      if (!writeResult.ok) {
        return writeResult;
      }

      return {
        ...writeResult,
        appliedCount: patched.appliedCount,
      };
    } catch (error) {
      return {
        ok: false,
        error: normalizeWorkspaceError(error, 'Unable to patch workspace file.'),
      };
    }
  });
  ipcMain.handle('workspace:list-files', async (_event, payload) => listWorkspaceFilesTree(payload?.traceId));
  ipcMain.handle('workspace:list-dir', async (_event, payload) =>
    listWorkspaceDirectoryPaged({
      inputPath: payload?.path,
      page: payload?.page,
      pageSize: payload?.pageSize,
      traceId: payload?.traceId,
    }),
  );
  ipcMain.handle('workspace:search-text', async (_event, payload) =>
    searchWorkspaceText({
      query: payload?.query,
      isRegex: payload?.isRegex,
      maxResults: payload?.maxResults,
      traceId: payload?.traceId,
    }),
  );
  ipcMain.handle('workspace:search-paths', async (_event, payload) =>
    searchWorkspacePaths({
      pattern: payload?.pattern,
      maxResults: payload?.maxResults,
      traceId: payload?.traceId,
    }),
  );
  ipcMain.handle('workspace:fetch-webpage', async (_event, payload) =>
    mcpToolsService.fetchWebpage(payload || {}),
  );
  ipcMain.handle('workspace:get-errors', async (_event, payload) =>
    collectWorkspaceDiagnostics({
      inputPath: payload?.path,
      traceId: payload?.traceId,
    }),
  );
  ipcMain.handle('save-chat-session', async (_event, payload) => {
    ensureChatSessionsDirectory();

    const sessionId = String(payload?.sessionId || 'default-session');
    const sessionState = sanitizeChatSessionState(payload?.messages && !payload?.appliedActionIds ? payload.messages : payload);
    const targetFilePath = resolveChatSessionFilePath(sessionId);

    await fsPromises.writeFile(targetFilePath, JSON.stringify(sessionState, null, 2), 'utf-8');
    return { ok: true };
  });
  ipcMain.handle('load-chat-session', async (_event, payload) => {
    ensureChatSessionsDirectory();

    const sessionId = String(payload?.sessionId || 'default-session');
    const targetFilePath = resolveChatSessionFilePath(sessionId);

    try {
      const raw = await fsPromises.readFile(targetFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return sanitizeChatSessionState(parsed);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          messages: [],
          appliedActionIds: [],
        };
      }
      return {
        messages: [],
        appliedActionIds: [],
      };
    }
  });
  ipcMain.handle('runtime:getHardwareMetrics', async () => hardwareSnapshot);
  ipcMain.handle('ai:get-settings', async () => getAiAssistantSettings());
  ipcMain.handle('ai:set-settings', async (_event, payload) => setAiAssistantSettings(payload || {}));
  ipcMain.handle('check-local-models', async () => getLocalModelState());
  ipcMain.handle('check-local-llama-servers', async () => getLocalLlamaServers());
  ipcMain.handle('download-llama-server-version', async (_event, payload) => {
    const flavor = String(payload?.flavor || 'auto').toLowerCase();
    const paths = getRuntimePaths(app);
    await fsPromises.mkdir(paths.llamaServerDir, { recursive: true });
    await fsPromises.mkdir(paths.tempDir, { recursive: true });

    const result = await runtimeBootstrapService.installLlamaServerVersion({
      paths,
      preferredFlavor: flavor,
    });

    setAiAssistantSettings({
      llamaServer: {
        selectedFlavor: flavor,
      },
    });

    return {
      ok: true,
      ...result,
      requestedFlavor: flavor,
    };
  });
  ipcMain.handle('lmstudio:get-models', async (_event, payload) => {
    const url = buildLmStudioModelsUrl(payload || {});
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`LM Studio request failed with status ${response.status}`);
    }

    const parsed = await response.json();
    const source = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
    const models = source
      .map((entry) => ({
        id: String(entry?.id || entry?.model || '').trim(),
      }))
      .filter((entry) => Boolean(entry.id));

    return {
      endpoint: url,
      models,
    };
  });
  ipcMain.handle('settings:getAppearance', async () => ({
    paneDimensions: getPaneDimensions(),
  }));
  ipcMain.handle('settings:setAppearance', async (_event, payload) => ({
    paneDimensions: setPaneDimensions(payload?.paneDimensions || {}),
  }));
  ipcMain.handle('project:listTree', async () => projectService.listProjectTree());
  ipcMain.handle('project:readFile', async (_event, payload) => projectService.readProjectFile(payload || {}));

  ipcMain.handle('workspace:index-stats', async () => workspaceIndex.getIndexStats());
  ipcMain.handle('workspace:index-paths', async () => workspaceIndex.getAllPaths());
  ipcMain.handle('workspace:index-search', async (_event, pattern) => workspaceIndex.searchPaths(pattern || ''));
  ipcMain.handle('workspace:index-lookup', async (_event, relativePath) => ({
    exists: await workspaceIndex.isKnownPath(String(relativePath || '')),
  }));
  ipcMain.handle('workspace:index-find-file', async (_event, name) => workspaceIndex.findFileByName(String(name || '') || ''));

  ipcMain.handle('git:status', async () => projectService.getGitStatus());
  ipcMain.handle('git:commit', async (_event, payload) => projectService.commitChanges(payload || {}));
  ipcMain.handle('git-stage-file', async (_event, payload) => projectService.stageFile(payload || {}));
  ipcMain.handle('git-unstage-file', async (_event, payload) => projectService.unstageFile(payload || {}));
  ipcMain.handle('git-revert-file', async (_event, payload) => projectService.revertFile(payload || {}));
  ipcMain.handle('git-stage-all', async () => projectService.stageAll());
  ipcMain.handle('git-unstage-all', async () => projectService.unstageAll());
  ipcMain.handle('git-revert-all', async () => projectService.revertAll());
  ipcMain.handle('git-get-diff-content', async (_event, payload) => projectService.getDiffContent(payload || {}));

  ipcMain.handle('database-connect', async (_event, payload) => databaseService.connect(payload || {}));
  ipcMain.handle('database-get-tables', async () => databaseService.getTables());
  ipcMain.handle('db-fetch-rows', async (_event, payload) => databaseService.fetchRows(payload || {}));
  ipcMain.handle('db-delete-row', async (_event, payload) => databaseService.deleteRow(payload || {}));
  ipcMain.handle('db-update-row', async (_event, payload) => databaseService.updateRow(payload || {}));
  ipcMain.handle('db-insert-row', async (_event, payload) => databaseService.insertRow(payload || {}));
  ipcMain.handle('db-save-connection', async (_event, payload) => {
    const profile = normalizeDbProfile(payload || {});

    if (!profile.alias) {
      throw new Error('Connection alias is required.');
    }

    if (profile.driver === 'sqlite') {
      if (!profile.sqlitePath) {
        throw new Error('sqlitePath is required for SQLite connections.');
      }
    } else if (!profile.host || !profile.user || !profile.database) {
      throw new Error('host, user, and database are required.');
    }

    const existing = getSavedDatabaseConnections();
    const nextProfiles = [
      profile,
      ...existing.filter((entry) => String(entry?.alias || '').toLowerCase() !== profile.alias.toLowerCase()),
    ];

    dbProfilesStore.set('databaseConnections', nextProfiles);
    return {
      saved: true,
      profiles: nextProfiles,
    };
  });
  ipcMain.handle('db-get-saved-connections', async () => ({
    profiles: getSavedDatabaseConnections(),
  }));
  ipcMain.handle('db-delete-connection', async (_event, payload) => {
    const alias = String(payload?.alias || '').trim();
    if (!alias) {
      throw new Error('Connection alias is required.');
    }

    const remaining = getSavedDatabaseConnections().filter(
      (entry) => String(entry?.alias || '').toLowerCase() !== alias.toLowerCase(),
    );

    dbProfilesStore.set('databaseConnections', remaining);
    return {
      deleted: true,
      profiles: remaining,
    };
  });

  ipcMain.handle('db-fetch-schema', async (_event, payload) => databaseService.fetchSchema(payload || {}));
  ipcMain.handle('db-get-row-count', async (_event, payload) => databaseService.getRowCount(payload || {}));
  ipcMain.handle('db-execute-query', async (_event, payload) => databaseService.executeQuery(payload || {}));
  ipcMain.handle('db-browse-sqlite', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle('aider:check', async () => aiderService.checkAvailable());

  ipcMain.handle('opencode:check', async () => opencodeService.checkAvailable());
  ipcMain.handle('opencode:start-server', async (_event, payload) => opencodeService.startServer({ settings: payload?.settings }));
  ipcMain.handle('opencode:stop-server', async () => opencodeService.stopServer());

  ipcMain.handle('mcp:terminalExecute', async (_event, payload) =>
    mcpToolsService.executeTerminalTool(payload || {}),
  );
  ipcMain.handle('mcp:duckduckgoSearch', async (_event, payload) =>
    mcpToolsService.duckduckgoSearch(payload || {}),
  );

  ipcMain.handle('ai:send-prompt', async (_event, payload) => {
    const settings = payload?.settings || {};
    if (settings.agentType === 'aider') {
      return aiderService.sendMessage({
        traceId: String(payload?.traceId || ''),
        prompt: String(payload?.prompt || ''),
        settings,
        workspaceRoot: String(payload?.workspaceRoot || workspaceService.getWorkspaceRoot()),
      });
    }
    if (settings.agentType === 'opencode') {
      return opencodeService.sendMessage({
        traceId: String(payload?.traceId || ''),
        prompt: String(payload?.prompt || ''),
        history: Array.isArray(payload?.history) ? payload.history : [],
        settings: { ...settings, workspaceRoot: String(payload?.workspaceRoot || workspaceService.getWorkspaceRoot()) },
      });
    }
    return aiOrchestratorService.sendPrompt({
      traceId: String(payload?.traceId || ''),
      prompt: String(payload?.prompt || ''),
      history: Array.isArray(payload?.history) ? payload.history : [],
      settings,
      workspaceRoot: String(payload?.workspaceRoot || workspaceService.getWorkspaceRoot()),
    });
  });
  ipcMain.handle('ai:respond-action', async (_event, payload) =>
    aiOrchestratorService.respondToAction({
      traceId: String(payload?.traceId || ''),
      actionId: String(payload?.actionId || ''),
      approved: Boolean(payload?.approved),
    }),
  );
  ipcMain.handle('ai:cancel-session', async (_event, payload) => {
    const traceId = String(payload?.traceId || '');
    aiOrchestratorService.cancelSession({ traceId });
    opencodeService.abortSession(traceId);
  });

  // ── Layer 1: Project Metadata ──────────────────────────────────────
  ipcMain.handle('project:metadata', async () => projectMetadataService.getMetadata());
  ipcMain.handle('project:metadata-summary', async () => projectMetadataService.getContextSummary());
  ipcMain.handle('project:metadata-refresh', async () => projectMetadataService.refresh());

  // ── Layer 2: Code Search ───────────────────────────────────────────
  ipcMain.handle('codesearch:search', async (_event, query) => codeSearchService.search(String(query || '')));
  ipcMain.handle('codesearch:find-by-type', async (_event, type) => codeSearchService.findByType(String(type || '')));
  ipcMain.handle('codesearch:find-by-name', async (_event, name) => codeSearchService.findByName(String(name || '')));
  ipcMain.handle('codesearch:find-by-file', async (_event, filePath) => codeSearchService.findByFile(String(filePath || '')));
  ipcMain.handle('codesearch:stats', async () => codeSearchService.getIndexStats());
  ipcMain.handle('codesearch:summary', async () => codeSearchService.getContextSummary());
  ipcMain.handle('codesearch:refresh', async () => codeSearchService.refresh());

  // ── Layer 3: Patch Service ─────────────────────────────────────────
  ipcMain.handle('patch:search-replace', async (_event, payload) =>
    patchService.applySearchReplace({ filePath: String(payload?.path || ''), blocks: Array.isArray(payload?.blocks) ? payload.blocks : [] }),
  );
  ipcMain.handle('patch:unified-diff', async (_event, payload) =>
    patchService.applyUnifiedDiff({ filePath: String(payload?.path || ''), diff: String(payload?.diff || '') }),
  );
  ipcMain.handle('patch:create-diff', async (_event, payload) =>
    patchService.createUnifiedDiff({ filePath: String(payload?.path || '') }),
  );
  ipcMain.handle('patch:rollback', async (_event, payload) =>
    patchService.rollback({ filePath: String(payload?.path || '') }),
  );

  // ── Layer 4: Validation ────────────────────────────────────────────
  ipcMain.handle('validation:lint', async () => validationService.runLint());
  ipcMain.handle('validation:typecheck', async () => validationService.runTypeCheck());
  ipcMain.handle('validation:build', async () => validationService.runBuild());
  ipcMain.handle('validation:tests', async (_event, payload) => validationService.runTests({ testFile: String(payload?.testFile || '') || undefined }));
  ipcMain.handle('validation:all', async () => validationService.runAll());
  ipcMain.handle('validation:trigger', async () => validationService.trigger());

  ipcMain.handle('window:minimize', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindowRef;
    if (!win || win.isDestroyed()) {
      return { ok: false };
    }
    win.minimize();
    return { ok: true };
  });

  ipcMain.handle('window:toggleMaximize', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindowRef;
    if (!win || win.isDestroyed()) {
      return { ok: false, maximized: false };
    }

    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }

    return { ok: true, maximized: win.isMaximized() };
  });

  ipcMain.handle('window:close', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindowRef;
    if (!win || win.isDestroyed()) {
      return { ok: false };
    }
    win.close();
    return { ok: true };
  });

  ipcMain.handle('window:isMaximized', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindowRef;
    if (!win || win.isDestroyed()) {
      return { maximized: false };
    }
    return { maximized: win.isMaximized() };
  });

  ipcMain.handle('terminal-create', async (_event, payload) =>
    initializeTerminalShell(workspaceService.getWorkspaceRoot(), {
      terminalId: payload?.terminalId,
      cols: payload?.cols,
      rows: payload?.rows,
    }),
  );

  ipcMain.handle('terminal-list', async () => ({
    terminals: Array.from(terminalSessions.entries()).map(([terminalId, session]) => ({
      terminalId,
      cwd: session.cwd,
    })),
  }));

  ipcMain.handle('terminal-send-input', async (_event, payload) => {
    const terminalId = String(payload?.terminalId || 'terminal-1');
    const command = String(payload?.command ?? '');
    const session = terminalSessions.get(terminalId);
    if (!session?.pty) {
      return { ok: false };
    }

    if (command) {
      session.pty.write(command);
    }
    return { ok: true };
  });

  ipcMain.handle('terminal-resize', async (_event, payload) =>
    resizeTerminalSession(
      String(payload?.terminalId || 'terminal-1'),
      Number(payload?.cols || 100),
      Number(payload?.rows || 30),
    ),
  );

  ipcMain.handle('terminal-close', async (_event, payload) => {
    const terminalId = String(payload?.terminalId || '');
    if (!terminalId) {
      return { ok: false };
    }

    killTerminalSession(terminalId);
    return { ok: true };
  });

  ipcMain.handle('terminal-restart-shell', async (_event, payload) =>
    initializeTerminalShell(workspaceService.getWorkspaceRoot(), {
      terminalId: payload?.terminalId || 'terminal-1',
      cols: payload?.cols,
      rows: payload?.rows,
    }),
  );
};

const createWindow = () => {
  const isDevMode = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL) && !app.isPackaged;
  const mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      devTools: isDevMode,
    },
  });

  if (app.isPackaged) {
    mainWindow.removeMenu();
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const appShortcutId = resolveAppShortcutId(input);
    if (appShortcutId) {
      event.preventDefault();
      mainWindow.webContents.send('app:shortcut', { id: appShortcutId });
      return;
    }

    if (!isDevMode && shouldBlockDevShortcut(input)) {
      event.preventDefault();
    }
  });

  if (!isDevMode) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindowRef = mainWindow;
  startWatchingWorkspace(mainWindow, workspaceService.getWorkspaceRoot());

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.maximize();
      mainWindow.show();
    }
  });

  const emitWindowState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximizedChanged', {
        maximized: mainWindow.isMaximized(),
      });
    }
  };

  mainWindow.on('maximize', emitWindowState);
  mainWindow.on('unmaximize', emitWindowState);
  mainWindow.on('enter-full-screen', emitWindowState);
  mainWindow.on('leave-full-screen', emitWindowState);

  initializeTerminalShell(workspaceService.getWorkspaceRoot(), { terminalId: 'terminal-1' });

  startHardwareMonitor();

  mainWindow.on('closed', () => {
    if (!BrowserWindow.getAllWindows().length) {
      stopHardwareMonitor();
    }
  });
};

app.whenReady().then(async () => {
  await runtimeBootstrapService.prepareRuntimeDirectories();

  registerIpcHandlers();
  createWindow();

  // Eagerly build indexes in background for faster first prompt
  setTimeout(() => {
    Promise.all([
      workspaceIndex.ensureFresh(),
      codeSearchService?.buildIndex?.().catch(() => {}),
    ]).catch(() => {});
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  appIsQuitting = true;
  stopWatchingWorkspace();
  stopHardwareMonitor();
  for (const terminalId of Array.from(terminalSessions.keys())) {
    killTerminalSession(terminalId);
  }
  await databaseService.disconnect();
  await llamaService.shutdown();
});
