import Link from 'next/link';
import { AppLogo } from './AppLogo';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <Link href="/" className="footer-brand">
          <AppLogo size={20} />
          Notebook AI
        </Link>
        <div className="footer-links">
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <a href="mailto:support@notebookai.dev">Contact</a>
        </div>
        <span className="footer-copy">© {new Date().getFullYear()} Notebook AI. All rights reserved.</span>
      </div>
    </footer>
  );
}
