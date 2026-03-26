import type { ReactNode } from 'react';
import '@notebook-ai/theme/src/tokens.css';
import '@notebook-ai/ui/src/styles.css';
import './globals.css';

export const metadata = {
  title: 'Notebook AI',
  description: 'Desktop-first AI meeting recorder and transcript copilot',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
