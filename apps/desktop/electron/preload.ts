import { contextBridge, ipcRenderer } from 'electron';

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
  platform: string;
}

contextBridge.exposeInMainWorld('notebookDesktop', {
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  getAppInfo: () => ipcRenderer.invoke('app:get-info') as Promise<DesktopAppInfo>,
  getLocalApiToken: () => ipcRenderer.invoke('app:get-local-api-token') as Promise<string>,
  chooseDirectory: () => ipcRenderer.invoke('app:choose-directory') as Promise<string | null>,
  consumeAuthCallback: () => ipcRenderer.invoke('auth:consume-callback-url') as Promise<string | null>,
  getAuthSession: () => ipcRenderer.invoke('auth:get-session') as Promise<DesktopRendererSession | null>,
  saveAuthSession: (payload: unknown) =>
    ipcRenderer.invoke('auth:save-session', payload) as Promise<DesktopRendererSession | null>,
  clearAuthSession: () => ipcRenderer.invoke('auth:clear-session') as Promise<null>,
  startGoogleSignIn: () => ipcRenderer.invoke('auth:start-google-sign-in') as Promise<string>,
  sendMagicLink: (email: string) => ipcRenderer.invoke('auth:send-magic-link', email) as Promise<null>,
  getAuthStorageItem: (key: string) =>
    ipcRenderer.invoke('auth:get-storage-item', key) as Promise<string | null>,
  setAuthStorageItem: (key: string, value: string) =>
    ipcRenderer.invoke('auth:set-storage-item', key, value) as Promise<string>,
  removeAuthStorageItem: (key: string) =>
    ipcRenderer.invoke('auth:remove-storage-item', key) as Promise<null>,
  onAuthCallback: (handler: (url: string) => void) => {
    const listener = (_event: unknown, url: string) => handler(url);
    ipcRenderer.on('auth:callback-url', listener);
    return () => {
      ipcRenderer.removeListener('auth:callback-url', listener);
    };
  },
  onAuthSessionUpdated: (handler: (session: DesktopRendererSession | null) => void) => {
    const listener = (_event: unknown, session: DesktopRendererSession | null) => handler(session);
    ipcRenderer.on('auth:session-updated', listener);
    return () => {
      ipcRenderer.removeListener('auth:session-updated', listener);
    };
  },
});

declare global {
  interface Window {
    notebookDesktop: {
      openExternal: (url: string) => Promise<void>;
      getAppInfo: () => Promise<DesktopAppInfo>;
      getLocalApiToken: () => Promise<string>;
      chooseDirectory: () => Promise<string | null>;
      consumeAuthCallback: () => Promise<string | null>;
      getAuthSession: () => Promise<DesktopRendererSession | null>;
      saveAuthSession: (payload: unknown) => Promise<DesktopRendererSession | null>;
      clearAuthSession: () => Promise<null>;
      startGoogleSignIn: () => Promise<string>;
      sendMagicLink: (email: string) => Promise<null>;
      getAuthStorageItem: (key: string) => Promise<string | null>;
      setAuthStorageItem: (key: string, value: string) => Promise<string>;
      removeAuthStorageItem: (key: string) => Promise<null>;
      onAuthCallback: (handler: (url: string) => void) => () => void;
      onAuthSessionUpdated: (handler: (session: DesktopRendererSession | null) => void) => () => void;
    };
  }
}
