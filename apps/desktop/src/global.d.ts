export {};

declare global {
  interface Window {
    notebookDesktop: {
      openExternal: (url: string) => Promise<void>;
      chooseDirectory: () => Promise<string | null>;
      onAuthCallback: (handler: (url: string) => void) => () => void;
    };
  }
}
