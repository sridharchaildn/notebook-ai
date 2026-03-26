import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell, type OpenDialogOptions } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let sidecarProcess: ChildProcess | null = null;
let cloudApiProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

function isPortOpen(port: number, host = '127.0.0.1') {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host });
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function startSidecar() {
  if (sidecarProcess) return;
  if (await isPortOpen(8787)) {
    process.stdout.write('[sidecar] Reusing existing service on 127.0.0.1:8787\n');
    return;
  }

  const devRoot = path.resolve(__dirname, '../../..');
  const sidecarCwd = path.resolve(devRoot, 'services/local-sidecar');
  const sidecarVenvPython = path.join(sidecarCwd, '.venv/bin/python');
  const defaultSidecarCommand = fs.existsSync(sidecarVenvPython)
    ? `${sidecarVenvPython} -m uvicorn app.main:app --host 127.0.0.1 --port 8787`
    : 'python3.11 -m uvicorn app.main:app --host 127.0.0.1 --port 8787';
  const sidecarCommand =
    process.env.NOTEBOOK_LOCAL_SIDECAR_CMD ?? defaultSidecarCommand;

  sidecarProcess = spawn(sidecarCommand, {
    cwd: sidecarCwd,
    shell: true,
    stdio: 'pipe',
  });

  sidecarProcess.stdout?.on('data', (chunk) => {
    process.stdout.write(`[sidecar] ${chunk.toString()}`);
  });

  sidecarProcess.stderr?.on('data', (chunk) => {
    process.stderr.write(`[sidecar:error] ${chunk.toString()}`);
  });

  sidecarProcess.on('exit', () => {
    sidecarProcess = null;
  });
}

async function startCloudApi() {
  if (cloudApiProcess) return;
  if (await isPortOpen(8790)) {
    process.stdout.write('[cloud-api] Reusing existing service on 127.0.0.1:8790\n');
    return;
  }

  const devRoot = path.resolve(__dirname, '../../..');
  const cloudCwd = path.resolve(devRoot, 'services/cloud-api');
  const cloudVenvPython = path.join(cloudCwd, '.venv/bin/python');
  const defaultCloudCommand = fs.existsSync(cloudVenvPython)
    ? `${cloudVenvPython} -m uvicorn app.main:app --host 127.0.0.1 --port 8790`
    : 'python3.11 -m uvicorn app.main:app --host 127.0.0.1 --port 8790';
  const cloudCommand = process.env.NOTEBOOK_CLOUD_API_CMD ?? defaultCloudCommand;

  cloudApiProcess = spawn(cloudCommand, {
    cwd: cloudCwd,
    shell: true,
    stdio: 'pipe',
  });

  cloudApiProcess.stdout?.on('data', (chunk) => {
    process.stdout.write(`[cloud-api] ${chunk.toString()}`);
  });

  cloudApiProcess.stderr?.on('data', (chunk) => {
    process.stderr.write(`[cloud-api:error] ${chunk.toString()}`);
  });

  cloudApiProcess.on('exit', () => {
    cloudApiProcess = null;
  });
}

function stopSidecar() {
  if (!sidecarProcess) return;
  sidecarProcess.kill();
  sidecarProcess = null;
}

function stopCloudApi() {
  if (!cloudApiProcess) return;
  cloudApiProcess.kill();
  cloudApiProcess = null;
}

function createWindow() {
  const preloadMjs = path.join(__dirname, 'preload.mjs');
  const preloadJs = path.join(__dirname, 'preload.js');
  const preloadPath = fs.existsSync(preloadMjs) ? preloadMjs : preloadJs;

  const window = new BrowserWindow({
    width: 1460,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0A1110',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void openUrlOutsideApp(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  mainWindow = window;
}

function handleAuthCallbackUrl(rawUrl: string) {
  if (!rawUrl.startsWith('notebook-ai://')) return;
  if (mainWindow) {
    mainWindow.webContents.send('auth:callback-url', rawUrl);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

function focusOrCreateMainWindow() {
  const existing = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!existing) {
    createWindow();
    return;
  }

  mainWindow = existing;
  if (existing.isMinimized()) existing.restore();
  existing.show();
  existing.focus();
}

async function openUrlOutsideApp(url: string) {
  try {
    await shell.openExternal(url);
    return;
  } catch (error) {
    if (process.platform === 'darwin') {
      try {
        const opener = spawn('open', [url], {
          detached: true,
          stdio: 'ignore',
        });
        opener.unref();
        return;
      } catch {
        /* fall through to original error */
      }
    }
    throw error;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  const callbackUrl = argv.find((arg) => arg.startsWith('notebook-ai://'));
  if (callbackUrl) {
    handleAuthCallbackUrl(callbackUrl);
    focusOrCreateMainWindow();
    return;
  }
  focusOrCreateMainWindow();
});

app.whenReady().then(async () => {
  app.setAsDefaultProtocolClient('notebook-ai');

  await Promise.all([startSidecar(), startCloudApi()]);

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
      });

      if (!sources[0]) {
        callback({
          audio: 'loopback',
        });
        return;
      }

      callback({
        video: sources[0],
        audio: 'loopback',
      });
    },
    { useSystemPicker: false },
  );

  ipcMain.handle('app:open-external', async (_event, url: string) => {
    await openUrlOutsideApp(url);
  });

  ipcMain.handle('app:choose-directory', async () => {
    const browser = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const result = browser
      ? await dialog.showOpenDialog(browser, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  createWindow();

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleAuthCallbackUrl(url);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopSidecar();
  stopCloudApi();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopSidecar();
  stopCloudApi();
});
