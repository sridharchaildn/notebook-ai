import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
  session,
  shell,
  type OpenDialogOptions,
} from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGED_CLOUD_API_URL = 'https://api.notebook-ai.app';
const BUILT_CLOUD_API_URL = import.meta.env.VITE_CLOUD_API_URL?.trim();
const RUNTIME_CLOUD_API_URL = process.env.NOTEBOOK_CLOUD_API_URL?.trim();
const CLOUD_API_URL =
  RUNTIME_CLOUD_API_URL ||
  BUILT_CLOUD_API_URL ||
  (app.isPackaged ? DEFAULT_PACKAGED_CLOUD_API_URL : 'http://127.0.0.1:8790');
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  '';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  '';
const DESKTOP_AUTH_CALLBACK_URL =
  import.meta.env.VITE_DESKTOP_AUTH_CALLBACK_URL ??
  process.env.VITE_DESKTOP_AUTH_CALLBACK_URL ??
  'notebook-ai://auth/callback';
const DESKTOP_SUPABASE_STORAGE_KEY = 'notebook-ai-desktop-auth';
const DESKTOP_PENDING_AUTH_KEY = 'notebook-ai-desktop-auth-pending';
const APP_DISPLAY_NAME = 'Notebook AI';
const SIDE_CAR_ALLOWED_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'null',
].join(',');
const CLOUD_ALLOWED_ORIGINS = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'null',
].join(',');

interface StoredSupabaseSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  tokenType: string | null;
  userId: string;
  userEmail: string | null;
}

interface PersistedAuthState {
  session: StoredSupabaseSession | null;
  authStorage: Record<string, string>;
}

interface DesktopRendererSession {
  accessToken: string;
  expiresAt: number | null;
  userId: string;
  userEmail: string | null;
}

interface DesktopAppInfo {
  version: string;
  buildVersion: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  cloudApiUrl: string;
}

let sidecarProcess: ChildProcess | null = null;
let cloudApiProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
const pendingDeepLinks: string[] = [];
let cachedAuthState: PersistedAuthState | null = null;
let cachedDesktopClientToken: string | null = null;
let lastAuthSessionLog: string | null = null;

function logAuthSession(message: string) {
  if (lastAuthSessionLog === message) return;
  lastAuthSessionLog = message;
  process.stdout.write(`${message}\n`);
}

function createNotebookAppIcon() {
  const candidatePaths = [
    path.join(__dirname, '../assets/icon.svg'),
    path.join(process.cwd(), 'apps/desktop/assets/icon.svg'),
  ];

  for (const candidate of candidatePaths) {
    if (!fs.existsSync(candidate)) continue;
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) {
      const resized = image.resize({ width: 256, height: 256 });
      return nativeImage.createFromBuffer(resized.toPNG());
    }
  }

  const fallbackSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect x="20" y="20" width="216" height="216" rx="56" fill="#171717" />
      <path d="M62 68h52c23 0 42 19 42 42v92c-8-10-19-15-34-15H62z" fill="none" stroke="#ffffff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M194 68h-52c-23 0-42 19-42 42v92c8-10 19-15 34-15h60z" fill="none" stroke="#ffffff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `.trim();
  const fallback = nativeImage
    .createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg)}`)
    .resize({ width: 256, height: 256 });
  return nativeImage.createFromBuffer(fallback.toPNG());
}

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

function authStatePath() {
  return path.join(app.getPath('userData'), 'auth-state.bin');
}

function desktopClientTokenPath() {
  return path.join(app.getPath('userData'), 'desktop-client-token.bin');
}

function desktopClientTokenFallbackPath() {
  return path.join(app.getPath('userData'), 'desktop-client-token.txt');
}

function cloneAuthState(state: PersistedAuthState): PersistedAuthState {
  return {
    session: state.session ? { ...state.session } : null,
    authStorage: { ...state.authStorage },
  };
}

function readPersistedAuthState(): PersistedAuthState {
  if (cachedAuthState) return cloneAuthState(cachedAuthState);

  const fallback: PersistedAuthState = { session: null, authStorage: {} };
  if (!safeStorage.isEncryptionAvailable()) {
    cachedAuthState = fallback;
    return cloneAuthState(fallback);
  }

  const filePath = authStatePath();
  if (!fs.existsSync(filePath)) {
    cachedAuthState = fallback;
    return cloneAuthState(fallback);
  }

  try {
    const encrypted = fs.readFileSync(filePath);
    const decrypted = safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(decrypted) as PersistedAuthState;
    cachedAuthState = {
      session: parsed.session ? { ...parsed.session } : null,
      authStorage:
        parsed.authStorage && typeof parsed.authStorage === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.authStorage).filter(
                ([key, value]) => typeof key === 'string' && typeof value === 'string',
              ),
            )
          : {},
    };
    return cloneAuthState(cachedAuthState);
  } catch {
    cachedAuthState = fallback;
    return cloneAuthState(fallback);
  }
}

function writePersistedAuthState(nextState: PersistedAuthState) {
  cachedAuthState = cloneAuthState(nextState);
  if (!safeStorage.isEncryptionAvailable()) {
    return;
  }

  const filePath = authStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const encrypted = safeStorage.encryptString(JSON.stringify(nextState));
  fs.writeFileSync(filePath, encrypted);
}

function readOrCreateDesktopClientToken(): string {
  if (cachedDesktopClientToken) return cachedDesktopClientToken;

  const encryptedPath = desktopClientTokenPath();
  const fallbackPath = desktopClientTokenFallbackPath();

  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(encryptedPath)) {
      const encrypted = fs.readFileSync(encryptedPath);
      const decrypted = safeStorage.decryptString(encrypted).trim();
      if (decrypted) {
        cachedDesktopClientToken = decrypted;
        return decrypted;
      }
    }

    if (fs.existsSync(fallbackPath)) {
      const raw = fs.readFileSync(fallbackPath, 'utf8').trim();
      if (raw) {
        cachedDesktopClientToken = raw;
        return raw;
      }
    }
  } catch {
    /* ignore corrupted token state and rotate below */
  }

  const created = randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(encryptedPath), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(encryptedPath, safeStorage.encryptString(created));
    if (fs.existsSync(fallbackPath)) {
      fs.rmSync(fallbackPath, { force: true });
    }
  } else {
    fs.writeFileSync(fallbackPath, created, { mode: 0o600 });
  }

  cachedDesktopClientToken = created;
  return created;
}

function desktopBuildVersion(): string {
  return process.env.NOTEBOOK_BUILD_VERSION?.trim() || app.getVersion();
}

function resolvePackagedBinary(paths: string[]): string | null {
  for (const candidate of paths) {
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      try {
        fs.chmodSync(candidate, 0o755);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function getDesktopAppInfo(): DesktopAppInfo {
  return {
    version: app.getVersion(),
    buildVersion: desktopBuildVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    cloudApiUrl: CLOUD_API_URL,
  };
}

function normalizeStoredSession(payload: unknown): StoredSupabaseSession | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const accessToken = typeof raw.access_token === 'string' ? raw.access_token.trim() : '';
  const refreshToken = typeof raw.refresh_token === 'string' ? raw.refresh_token.trim() : '';
  const user =
    raw.user && typeof raw.user === 'object' ? (raw.user as Record<string, unknown>) : null;
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  const userEmail = typeof user?.email === 'string' ? user.email : null;
  if (!accessToken || !refreshToken || !userId) return null;

  return {
    accessToken,
    refreshToken,
    expiresAt: typeof raw.expires_at === 'number' ? raw.expires_at : null,
    tokenType: typeof raw.token_type === 'string' ? raw.token_type : 'bearer',
    userId,
    userEmail,
  };
}

function readCallbackValue(rawUrl: string, key: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const direct = parsed.searchParams.get(key);
    if (direct) return direct;
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    return hashParams.get(key);
  } catch {
    return null;
  }
}

function decodeJwtExpiry(accessToken: string): number | null {
  const segments = accessToken.split('.');
  if (segments.length < 2 || !segments[1]) return null;
  try {
    const normalized = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function encodeBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generatePkceVerifier(): string {
  return encodeBase64Url(randomBytes(64));
}

function generatePkceChallenge(verifier: string): string {
  return encodeBase64Url(createHash('sha256').update(verifier).digest());
}

function storePkceVerifier(verifier: string) {
  const authState = readPersistedAuthState();
  writePersistedAuthState({
    ...authState,
    authStorage: {
      ...authState.authStorage,
      [`${DESKTOP_SUPABASE_STORAGE_KEY}-code-verifier`]: verifier,
    },
  });
}

function buildSupabaseGoogleAuthorizeUrl(): string {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', DESKTOP_AUTH_CALLBACK_URL);
  url.searchParams.set('prompt', 'select_account');
  const authState = readPersistedAuthState();
  writePersistedAuthState({
    ...authState,
    authStorage: {
      ...authState.authStorage,
      [DESKTOP_PENDING_AUTH_KEY]: '1',
    },
  });
  return url.toString();
}

async function sendSupabaseMagicLink(email: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error('Enter your email to receive a sign-in link.');
  }

  const url = new URL(`${SUPABASE_URL}/auth/v1/otp`);
  url.searchParams.set('redirect_to', DESKTOP_AUTH_CALLBACK_URL);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json;charset=UTF-8',
    },
    body: JSON.stringify({
      email: trimmed,
      create_user: true,
      data: {},
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || 'Unable to send magic link.');
  }

  const authState = readPersistedAuthState();
  writePersistedAuthState({
    ...authState,
    authStorage: {
      ...authState.authStorage,
      [DESKTOP_PENDING_AUTH_KEY]: '1',
    },
  });
}

async function fetchSupabaseUser(accessToken: string): Promise<{ id: string; email: string | null } | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { id?: unknown; email?: unknown };
  if (typeof payload.id !== 'string' || payload.id.trim().length === 0) {
    return null;
  }
  return {
    id: payload.id,
    email: typeof payload.email === 'string' ? payload.email : null,
  };
}

function persistStoredSession(session: StoredSupabaseSession) {
  const authState = readPersistedAuthState();
  const nextStorage = { ...authState.authStorage };
  delete nextStorage[`${DESKTOP_SUPABASE_STORAGE_KEY}-code-verifier`];
  delete nextStorage[DESKTOP_PENDING_AUTH_KEY];
  writePersistedAuthState({
    session,
    authStorage: nextStorage,
  });
}

async function persistSessionFromTokens(
  accessToken: string,
  refreshToken: string,
): Promise<StoredSupabaseSession | null> {
  const user = await fetchSupabaseUser(accessToken);
  if (!user) {
    return null;
  }

  const session: StoredSupabaseSession = {
    accessToken,
    refreshToken,
    expiresAt: decodeJwtExpiry(accessToken),
    tokenType: 'bearer',
    userId: user.id,
    userEmail: user.email,
  };
  persistStoredSession(session);
  return session;
}

async function exchangeSupabaseCodeInMain(authCode: string): Promise<StoredSupabaseSession | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    process.stdout.write('[auth] Supabase env missing in main process; cannot exchange callback code\n');
    return null;
  }

  const authState = readPersistedAuthState();
  const rawStorageItem = authState.authStorage[`${DESKTOP_SUPABASE_STORAGE_KEY}-code-verifier`] ?? '';
  const storageItem =
    rawStorageItem.startsWith('"') && rawStorageItem.endsWith('"')
      ? rawStorageItem.slice(1, -1)
      : rawStorageItem;
  const [codeVerifier] = storageItem.split('/');
  if (!codeVerifier) {
    process.stdout.write('[auth] Missing PKCE code verifier in secure desktop auth storage\n');
    return null;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_code: authCode,
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    process.stdout.write(`[auth] Supabase code exchange failed (${response.status}): ${detail}\n`);
    return null;
  }

  const payload = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_at?: unknown;
    token_type?: unknown;
    user?: { id?: unknown; email?: unknown } | null;
  };
  const session = normalizeStoredSession(payload);
  if (!session) {
    process.stdout.write('[auth] Supabase code exchange returned an invalid session payload\n');
    return null;
  }

  persistStoredSession(session);
  return session;
}

async function tryCompleteSupabaseCallbackInMain(rawUrl: string): Promise<StoredSupabaseSession | null> {
  const errorDescription = readCallbackValue(rawUrl, 'error_description') ?? readCallbackValue(rawUrl, 'error');
  if (errorDescription) {
    process.stdout.write(`[auth] Callback returned error: ${decodeURIComponent(errorDescription)}\n`);
    return null;
  }

  const code = readCallbackValue(rawUrl, 'code');
  if (code) {
    const session = await exchangeSupabaseCodeInMain(code);
    if (session) {
      process.stdout.write(`[auth] Session stored in main process for ${session.userId}\n`);
      return session;
    }
    return null;
  }

  const accessToken = readCallbackValue(rawUrl, 'access_token');
  const refreshToken = readCallbackValue(rawUrl, 'refresh_token');
  if (accessToken && refreshToken) {
    const session = await persistSessionFromTokens(accessToken, refreshToken);
    if (session) {
      process.stdout.write(`[auth] Token session stored in main process for ${session.userId}\n`);
      return session;
    }
  }

  return null;
}

function toRendererSession(session: StoredSupabaseSession | null): DesktopRendererSession | null {
  if (!session) return null;
  return {
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    userId: session.userId,
    userEmail: session.userEmail,
  };
}

function emitSessionUpdated(rendererSession: DesktopRendererSession | null) {
  if (!mainWindow) return;
  mainWindow.webContents.send('auth:session-updated', rendererSession);
}

function shouldRefreshSession(session: StoredSupabaseSession): boolean {
  if (!session.expiresAt) return false;
  return session.expiresAt * 1000 - Date.now() < 60_000;
}

async function refreshStoredSession(
  sessionToRefresh: StoredSupabaseSession,
): Promise<StoredSupabaseSession | null> {
  const response = await fetch(`${CLOUD_API_URL}/auth/session/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: sessionToRefresh.refreshToken }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { session?: unknown };
  return normalizeStoredSession(payload.session ?? null);
}

async function getStoredSessionForRenderer(): Promise<DesktopRendererSession | null> {
  const authState = readPersistedAuthState();
  if (!authState.session) {
    logAuthSession('[auth] get-session -> none');
    return null;
  }

  if (!shouldRefreshSession(authState.session)) {
    const session = toRendererSession(authState.session);
    logAuthSession(`[auth] get-session -> ${session?.userId ?? 'none'}`);
    return session;
  }

  const refreshed = await refreshStoredSession(authState.session);
  if (!refreshed) {
    writePersistedAuthState({ ...authState, session: null });
    logAuthSession('[auth] get-session -> refresh failed');
    return null;
  }

  writePersistedAuthState({ ...authState, session: refreshed });
  const session = toRendererSession(refreshed);
  logAuthSession(`[auth] get-session -> refreshed ${session?.userId ?? 'none'}`);
  return session;
}

async function startSidecar() {
  if (sidecarProcess) return;
  if (await isPortOpen(8787)) {
    process.stdout.write('[sidecar] Reusing existing service on 127.0.0.1:8787\n');
    return;
  }

  const devRoot = path.resolve(__dirname, '../../..');
  const sidecarCwd = path.resolve(devRoot, 'services/local-sidecar');
  const desktopToken = readOrCreateDesktopClientToken();
  const sidecarEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NOTEBOOK_LOCAL_ALLOWED_ORIGINS:
      process.env.NOTEBOOK_LOCAL_ALLOWED_ORIGINS ?? SIDE_CAR_ALLOWED_ORIGINS,
    NOTEBOOK_LOCAL_APP_VERSION: app.getVersion(),
    NOTEBOOK_LOCAL_BUILD_VERSION: desktopBuildVersion(),
    NOTEBOOK_LOCAL_CLOUD_API_URL: CLOUD_API_URL,
    NOTEBOOK_LOCAL_DESKTOP_TOKEN: desktopToken,
  };

  const bundledSidecar = process.platform === 'darwin'
    ? resolvePackagedBinary([
        path.join(process.resourcesPath, 'local-sidecar', 'notebook-ai-local-sidecar'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'local-sidecar', 'notebook-ai-local-sidecar'),
      ])
    : resolvePackagedBinary([
        path.join(process.resourcesPath, 'local-sidecar', 'notebook-ai-local-sidecar.exe'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'local-sidecar', 'notebook-ai-local-sidecar.exe'),
      ]);
  const bundledFfmpeg = process.platform === 'darwin'
    ? resolvePackagedBinary([
        path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'ffmpeg', 'ffmpeg'),
      ])
    : resolvePackagedBinary([
        path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'ffmpeg', 'ffmpeg.exe'),
      ]);
  if (app.isPackaged) {
    if (!bundledSidecar) {
      throw new Error(`Packaged sidecar binary not found under ${process.resourcesPath}`);
    }
    if (bundledFfmpeg && fs.existsSync(bundledFfmpeg)) {
      sidecarEnv.NOTEBOOK_LOCAL_FFMPEG_PATH = bundledFfmpeg;
    }
    sidecarProcess = spawn(bundledSidecar, [], {
      env: sidecarEnv,
      stdio: 'pipe',
    });
  } else {
    const sidecarVenvPython = path.join(sidecarCwd, '.venv/bin/python');
    const defaultSidecarCommand = fs.existsSync(sidecarVenvPython)
      ? `${sidecarVenvPython} -m uvicorn app.main:app --host 127.0.0.1 --port 8787`
      : 'python3.11 -m uvicorn app.main:app --host 127.0.0.1 --port 8787';
    const sidecarCommand = process.env.NOTEBOOK_LOCAL_SIDECAR_CMD ?? defaultSidecarCommand;

    sidecarProcess = spawn(sidecarCommand, {
      cwd: sidecarCwd,
      env: sidecarEnv,
      shell: true,
      stdio: 'pipe',
    });
  }

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
  if (app.isPackaged) {
    process.stdout.write('[cloud-api] Packaged desktop expects a hosted cloud API; skipping local spawn\n');
    return;
  }
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

  const cloudEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NOTEBOOK_CLOUD_ALLOWED_ORIGINS:
      process.env.NOTEBOOK_CLOUD_ALLOWED_ORIGINS ?? CLOUD_ALLOWED_ORIGINS,
    NOTEBOOK_CLOUD_APP_VERSION: app.getVersion(),
    NOTEBOOK_CLOUD_BUILD_VERSION: desktopBuildVersion(),
  };

  cloudApiProcess = spawn(cloudCommand, {
    cwd: cloudCwd,
    env: cloudEnv,
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

  const appIcon = createNotebookAppIcon();
  const window = new BrowserWindow({
    width: 1460,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: APP_DISPLAY_NAME,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0A1110',
    icon: appIcon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  window.webContents.on('did-finish-load', () => {
    void getStoredSessionForRenderer().then((session) => {
      emitSessionUpdated(session);
    });
    flushPendingDeepLinks();
  });

  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void openUrlOutsideApp(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
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
  process.stdout.write(`[auth] Received deep link: ${rawUrl}\n`);
  void (async () => {
    const session = await tryCompleteSupabaseCallbackInMain(rawUrl);
    if (session) {
      pendingDeepLinks.push(rawUrl);
      if (pendingDeepLinks.length > 12) {
        pendingDeepLinks.shift();
      }
      focusOrCreateMainWindow();
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        const rendererSession = toRendererSession(session);
        emitSessionUpdated(rendererSession);
        mainWindow.webContents.send('auth:callback-url', rawUrl);
      }
      return;
    }

    pendingDeepLinks.push(rawUrl);
    if (pendingDeepLinks.length > 12) {
      pendingDeepLinks.shift();
    }
    if (mainWindow) {
      mainWindow.webContents.send('auth:callback-url', rawUrl);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  })();
}

function focusOrCreateMainWindow() {
  if (!app.isReady()) {
    return;
  }

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
  if (!isAllowedExternalUrl(url)) {
    throw new Error('Blocked unsupported external URL.');
  }
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

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (
      !app.isPackaged &&
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    ) {
      return true;
    }
    return parsed.protocol === 'notebook-ai:';
  } catch {
    return false;
  }
}

function registerDeepLinkProtocol() {
  const protocol = 'notebook-ai';
  if (process.defaultApp && process.argv.length >= 2) {
    void app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1]!)]);
    return;
  }
  void app.setAsDefaultProtocolClient(protocol);
}

function flushPendingDeepLinks() {
  if (!mainWindow || pendingDeepLinks.length === 0) return;
  const latest = pendingDeepLinks[pendingDeepLinks.length - 1];
  if (!latest) return;
  process.stdout.write('[auth] Flushing pending deep link to renderer\n');
  mainWindow.webContents.send('auth:callback-url', latest);
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

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallbackUrl(url);
  focusOrCreateMainWindow();
});

app.whenReady().then(async () => {
  app.setName(APP_DISPLAY_NAME);
  process.stdout.write(`[cloud-api] Desktop using ${CLOUD_API_URL}\n`);
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(createNotebookAppIcon());
  }
  registerDeepLinkProtocol();

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

  ipcMain.handle('app:get-info', async () => getDesktopAppInfo());
  ipcMain.handle('app:get-local-api-token', async () => readOrCreateDesktopClientToken());

  ipcMain.handle('app:choose-directory', async () => {
    const browser = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] };
    const result = browser
      ? await dialog.showOpenDialog(browser, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('auth:consume-callback-url', () => {
    if (pendingDeepLinks.length === 0) return null;
    const latest = pendingDeepLinks[pendingDeepLinks.length - 1] ?? null;
    pendingDeepLinks.length = 0;
    process.stdout.write(`[auth] Renderer consumed deep link: ${latest ?? 'none'}\n`);
    return latest;
  });

  ipcMain.handle('auth:get-session', async () => getStoredSessionForRenderer());

  ipcMain.handle('auth:save-session', async (_event, payload: unknown) => {
    const sessionToPersist = normalizeStoredSession(payload);
    if (!sessionToPersist) {
      throw new Error('Invalid desktop auth session payload');
    }
    const authState = readPersistedAuthState();
    writePersistedAuthState({
      ...authState,
      session: sessionToPersist,
    });
    const rendererSession = toRendererSession(sessionToPersist);
    emitSessionUpdated(rendererSession);
    return rendererSession;
  });

  ipcMain.handle('auth:clear-session', async () => {
    const authState = readPersistedAuthState();
    writePersistedAuthState({ ...authState, session: null, authStorage: {} });
    emitSessionUpdated(null);
    return null;
  });

  ipcMain.handle('auth:get-storage-item', async (_event, key: string) => {
    const authState = readPersistedAuthState();
    return authState.authStorage[key] ?? null;
  });

  ipcMain.handle('auth:set-storage-item', async (_event, key: string, value: string) => {
    const authState = readPersistedAuthState();
    writePersistedAuthState({
      ...authState,
      authStorage: {
        ...authState.authStorage,
        [key]: value,
      },
    });
    return value;
  });

  ipcMain.handle('auth:remove-storage-item', async (_event, key: string) => {
    const authState = readPersistedAuthState();
    if (!(key in authState.authStorage)) {
      return null;
    }
    const nextStorage = { ...authState.authStorage };
    delete nextStorage[key];
    writePersistedAuthState({ ...authState, authStorage: nextStorage });
    return null;
  });

  ipcMain.handle('auth:start-google-sign-in', async () => {
    const url = buildSupabaseGoogleAuthorizeUrl();
    process.stdout.write('[auth] Prepared Google sign-in in main process\n');
    return url;
  });

  ipcMain.handle('auth:send-magic-link', async (_event, email: string) => {
    await sendSupabaseMagicLink(email);
    process.stdout.write('[auth] Prepared magic-link sign-in in main process\n');
    return null;
  });

  createWindow();
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(createNotebookAppIcon());
  }
  const launchDeepLink = process.argv.find((arg) => arg.startsWith('notebook-ai://'));
  if (launchDeepLink) {
    handleAuthCallbackUrl(launchDeepLink);
  }
  flushPendingDeepLinks();

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
