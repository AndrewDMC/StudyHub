import type { MetadataRoute } from 'next';

/**
 * Web app manifest: StudyHub installs to the home screen and opens standalone
 * (docs/09-ripasso-mobile.md §A1). No service worker yet: offline is out of scope (§7).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'StudyHub',
    short_name: 'StudyHub',
    description: 'Il tuo studio, organizzato.',
    lang: 'it',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0b0f',
    theme_color: '#111318',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
