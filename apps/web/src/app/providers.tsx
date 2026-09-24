'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // This talks to the app's own local/LAN backend, not the public
          // internet — the browser's online/offline heuristic is meaningless
          // here and can get stuck reporting offline (observed: fetchStatus
          // stuck at 'paused' with navigator.onLine still true), silently
          // hanging every query at "Caricamento…" forever with no error
          // surfaced. `networkMode: 'always'` makes requests run regardless.
          queries: { networkMode: 'always' },
          mutations: { networkMode: 'always' },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
