import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import { AppShell } from '@/components/AppShell';
import { NO_FLASH_SCRIPT } from '@/lib/appearance';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  title: 'StudyHub',
  description: 'Il tuo studio, organizzato.',
  // Home-screen install on iOS (the web manifest is app/manifest.ts). "black-translucent" draws
  // the page under the status bar; AppShell's header pads itself by the safe-area inset.
  appleWebApp: { capable: true, title: 'StudyHub', statusBarStyle: 'black-translucent' },
};

// viewport-fit=cover exposes env(safe-area-inset-*) to the shell (docs/09-ripasso-mobile.md §A1).
// theme-color follows the OS scheme: the chosen theme lives in localStorage, unknown to the server.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#111318' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="it"
      data-theme="dark"
      data-density="comfortable"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
