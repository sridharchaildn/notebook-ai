export {};

declare global {
  interface Window {
    notebookDesktop: {
      openExternal: (url: string) => Promise<void>;
    };
  }
}
