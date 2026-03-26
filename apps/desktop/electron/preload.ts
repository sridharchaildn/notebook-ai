import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('notebookDesktop', {
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  chooseDirectory: () => ipcRenderer.invoke('app:choose-directory') as Promise<string | null>,
  consumeAuthCallback: () => ipcRenderer.invoke('auth:consume-callback-url') as Promise<string | null>,
  onAuthCallback: (handler: (url: string) => void) => {
    const listener = (_event: unknown, url: string) => handler(url);
    ipcRenderer.on('auth:callback-url', listener);
    return () => {
      ipcRenderer.removeListener('auth:callback-url', listener);
    };
  },
});

declare global {
  interface Window {
    notebookDesktop: {
      openExternal: (url: string) => Promise<void>;
      chooseDirectory: () => Promise<string | null>;
      consumeAuthCallback: () => Promise<string | null>;
      onAuthCallback: (handler: (url: string) => void) => () => void;
    };
  }
}
