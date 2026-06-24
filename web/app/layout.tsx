import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'OpenReview Dashboard',
  description: 'Track coverage analysis runs and LLM spend across your PRs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="topbar-brand">
            <span className="topbar-brand-icon">⚡</span>
            OpenReview
          </Link>
          <nav className="topbar-nav">
            <Link href="/">Repositories</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
