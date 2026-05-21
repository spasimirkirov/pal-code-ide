import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import si from 'systeminformation';
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

const registerIpcHandlers = () => {
  ipcMain.handle('runtime:getWorkspaceRoot', async () => ({
    cwd: workspaceService.getWorkspaceRoot(),
  }));
  ipcMain.handle('runtime:setWorkspaceRoot', async (_event, payload) => ({
    cwd: workspaceService.setWorkspaceRoot(payload?.cwd),
  }));
  ipcMain.handle('runtime:bootstrap', runtimeBootstrapService.ensureRuntimeAssets);
  ipcMain.handle('runtime:cancelBootstrap', runtimeBootstrapService.cancelRuntimeBootstrap);
  ipcMain.handle('runtime:getHardwareMetrics', async () => hardwareSnapshot);
  ipcMain.handle('project:listTree', async () => projectService.listProjectTree());
  ipcMain.handle('project:readFile', async (_event, payload) => projectService.readProjectFile(payload || {}));

  ipcMain.handle('git:status', async () => projectService.getGitStatus());
  ipcMain.handle('git:commit', async (_event, payload) => projectService.commitChanges(payload || {}));

  ipcMain.handle('database-connect', async (_event, payload) => databaseService.connect(payload || {}));
  ipcMain.handle('database-get-tables', async () => databaseService.getTables());
  ipcMain.handle('db-fetch-rows', async (_event, payload) => databaseService.fetchRows(payload || {}));
  ipcMain.handle('db-delete-row', async (_event, payload) => databaseService.deleteRow(payload || {}));
  ipcMain.handle('db-insert-row', async (_event, payload) => databaseService.insertRow(payload || {}));

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
    },
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
  await databaseService.disconnect();
  await llamaService.shutdown();
});
