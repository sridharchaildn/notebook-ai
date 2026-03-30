export {};

interface DesktopRendererSession {
  accessToken: string;
  expiresAt: number | null;
  userId: string;
  userEmail: string | null;
}

declare global {
  interface Window {
    notebookDesktop: {
      openExternal: (url: string) => Promise<void>;
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
