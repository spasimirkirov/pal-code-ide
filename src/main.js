import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import si from 'systeminformation';
import Store from 'electron-store';
import * as nodePty from '@homebridge/node-pty-prebuilt-multiarch';
import started from 'electron-squirrel-startup';
import { getRuntimePaths } from './runtime/runtime-paths';
import { createWorkspaceService } from './runtime/workspace-service';
import { createRuntimeBootstrapService } from './runtime/bootstrap-service';
import { createProjectService } from './runtime/project-service';
import { createDatabaseService } from './runtime/database/database-service';
import { createLlamaService } from './llama-server/llama-service';
import { createMcpToolsService } from './mcp-tools/mcp-tools-service';

if (started) {
  app.quit();
}

let mainWindowRef = null;
let hardwareMonitorTimer = null;
let hardwareSnapshot = {
  vramUsed: 0,
  vramTotal: 0,
};
const terminalSessions = new Map();
let terminalSessionCounter = 1;

const LEGACY_MODELS_ROOT_DIR = path.join(app.getPath('appData'), 'pal-ide', 'models');

const dbProfilesStore = new Store({
  name: 'pal-code-ide-store',
  encryptionKey:
    process.env.PAL_STORE_ENCRYPTION_KEY ||
    'pal-code-ide-local-encryption-key',
  defaults: {
    databaseConnections: [],
  },
});

const appearanceStore = new Store({
  name: 'appearance',
  cwd: path.join(app.getPath('appData'), 'PalCode', 'settings'),
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
  cwd: path.join(app.getPath('appData'), 'pal-ide', 'settings'),
  defaults: {
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
    llamaServer: {
      selectedFlavor: 'auto',
    },
  },
});

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
  alias: String(payload.alias || '').trim(),
  host: String(payload.host || '').trim(),
  port: Number(payload.port || 3306),
  user: String(payload.user || '').trim(),
  password: String(payload.password || ''),
  database: String(payload.database || '').trim(),
  updatedAt: new Date().toISOString(),
});

const sanitizeAiAssistantSettings = (input = {}) => {
  const roleMappings = input?.roleMappings || {};
  const lmStudio = input?.lmStudio || {};
  const llamaServer = input?.llamaServer || {};
  const selectedFlavor = String(llamaServer.selectedFlavor || 'auto').toLowerCase();
  const allowedFlavor = ['auto', 'cpu', 'cuda', 'vulkan'].includes(selectedFlavor)
    ? selectedFlavor
    : 'auto';

  return {
    engine: String(input?.engine || 'llama-server') === 'lm-studio' ? 'lm-studio' : 'llama-server',
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
    llamaServer: {
      selectedFlavor: allowedFlavor,
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
    llamaServer: {
      ...getAiAssistantSettings().llamaServer,
      ...(payload?.llamaServer || {}),
    },
  });

  aiAssistantStore.set(merged);
  return merged;
};

const getLocalModelState = async () => {
  const runtimePaths = getRuntimePaths(app);
  const candidates = [runtimePaths.modelsDir, LEGACY_MODELS_ROOT_DIR];
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

const workspaceService = createWorkspaceService(process.cwd());
const runtimeBootstrapService = createRuntimeBootstrapService({
  app,
  getMainWindow: () => mainWindowRef,
});
const projectService = createProjectService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
});
const databaseService = createDatabaseService();
const llamaService = createLlamaService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
  getRuntimePaths: () => getRuntimePaths(app),
});
const mcpToolsService = createMcpToolsService({
  getWorkspaceRoot: workspaceService.getWorkspaceRoot,
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
    if (exitCode || signal) {
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
  if (!app.isPackaged || !input) {
    return false;
  }

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  const acceleratorPressed = Boolean(input.control || input.meta);

  return (
    key === 'f12' ||
    code === 'f12' ||
    (acceleratorPressed && input.shift && key === 'i') ||
    (acceleratorPressed && key === 'r')
  );
};

const registerIpcHandlers = () => {
  ipcMain.handle('runtime:getWorkspaceRoot', async () => ({
    cwd: workspaceService.getWorkspaceRoot(),
  }));
  ipcMain.handle('runtime:setWorkspaceRoot', async (_event, payload) => {
    const previous = workspaceService.getWorkspaceRoot();
    const next = workspaceService.setWorkspaceRoot(payload?.cwd);

    if (previous !== next) {
      const existingSessionIds = Array.from(terminalSessions.keys());
      for (const terminalId of existingSessionIds) {
        initializeTerminalShell(next, { terminalId });
      }
    }

    return {
      cwd: next,
    };
  });
  ipcMain.handle('runtime:bootstrap', runtimeBootstrapService.ensureRuntimeAssets);
  ipcMain.handle('runtime:cancelBootstrap', runtimeBootstrapService.cancelRuntimeBootstrap);
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

  ipcMain.handle('git:status', async () => projectService.getGitStatus());
  ipcMain.handle('git:commit', async (_event, payload) => projectService.commitChanges(payload || {}));
  ipcMain.handle('git-stage-file', async (_event, payload) => projectService.stageFile(payload || {}));
  ipcMain.handle('git-unstage-file', async (_event, payload) => projectService.unstageFile(payload || {}));
  ipcMain.handle('git-revert-file', async (_event, payload) => projectService.revertFile(payload || {}));
  ipcMain.handle('git-get-diff-content', async (_event, payload) => projectService.getDiffContent(payload || {}));

  ipcMain.handle('database-connect', async (_event, payload) => databaseService.connect(payload || {}));
  ipcMain.handle('database-get-tables', async () => databaseService.getTables());
  ipcMain.handle('db-fetch-rows', async (_event, payload) => databaseService.fetchRows(payload || {}));
  ipcMain.handle('db-delete-row', async (_event, payload) => databaseService.deleteRow(payload || {}));
  ipcMain.handle('db-insert-row', async (_event, payload) => databaseService.insertRow(payload || {}));
  ipcMain.handle('db-save-connection', async (_event, payload) => {
    const profile = normalizeDbProfile(payload || {});

    if (!profile.alias) {
      throw new Error('Connection alias is required.');
    }

    if (!profile.host || !profile.user || !profile.database) {
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

  ipcMain.handle('llama:status', llamaService.getLlamaStatus);
  ipcMain.handle('llama:start', llamaService.startLlama);
  ipcMain.handle('llama:stop', llamaService.stopLlama);

  ipcMain.handle('mcp:terminalExecute', async (_event, payload) =>
    mcpToolsService.executeTerminalTool(payload || {}),
  );
  ipcMain.handle('mcp:duckduckgoSearch', async (_event, payload) =>
    mcpToolsService.duckduckgoSearch(payload || {}),
  );

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
      devTools: !app.isPackaged,
    },
  });

  if (app.isPackaged) {
    mainWindow.removeMenu();
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (shouldBlockDevShortcut(input)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('devtools-opened', () => {
    if (app.isPackaged) {
      mainWindow.webContents.closeDevTools();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindowRef = mainWindow;

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
  stopHardwareMonitor();
  for (const terminalId of Array.from(terminalSessions.keys())) {
    killTerminalSession(terminalId);
  }
  await databaseService.disconnect();
  await llamaService.shutdown();
});
