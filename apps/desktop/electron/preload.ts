import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('notebookDesktop', {
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
});

declare global {
  interface Window {
    notebookDesktop: {
      openExternal: (url: string) => Promise<void>;
    };
  }
}
