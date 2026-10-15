'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 767.98px)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** true below md (768px). `null` on the server and until hydrated: render a neutral state then. */
export function useIsMobile(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => null,
  );
}
