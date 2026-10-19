'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Notify {
  success: (message: string) => void;
  error: (message: string) => void;
}

const NotifyContext = createContext<Notify | null>(null);

/** Toast API of the Flashcard tab: `success` (status, 5s) and `error` (alert, stays until closed). */
export function useNotify(): Notify {
  const ctx = useContext(NotifyContext);
  if (!ctx) throw new Error('useNotify outside NotifierProvider');
  return ctx;
}

/**
 * Provider plus the two live regions. Both regions are always mounted (a live region must exist
 * before its message), the toast boxes appear inside them.
 */
export function NotifierProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<{ id: number; text: string } | null>(null);
  const [paused, setPaused] = useState(false);
  const counter = useRef(0);

  const success = useCallback((text: string) => {
    counter.current += 1;
    setMessage({ id: counter.current, text });
  }, []);
  const error = useCallback((text: string) => {
    counter.current += 1;
    setErrorMessage({ id: counter.current, text });
  }, []);
  const api = useMemo(() => ({ success, error }), [success, error]);

  const messageId = message?.id;
  useEffect(() => {
    if (messageId === undefined || paused) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [messageId, paused]);

  const box =
    'pointer-events-auto rounded-[var(--radius-card)] border bg-bg-raised px-4 py-3 text-[13px] text-fg-primary shadow-lg';

  return (
    <NotifyContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-4 z-[80] flex max-w-[min(420px,calc(100vw-2rem))] flex-col gap-2 max-md:inset-x-4 max-md:bottom-[calc(env(safe-area-inset-bottom)+88px)] max-md:max-w-none">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          {message && <div className={`${box} border-border-strong`}>{message.text}</div>}
        </div>
        <div role="alert" aria-atomic="true">
          {errorMessage && (
            <div className={`${box} flex items-start gap-3 border-danger`}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
              <p className="min-w-0 flex-1 break-words">Non riuscito: {errorMessage.text}</p>
              <button
                type="button"
                aria-label="Chiudi"
                onClick={() => setErrorMessage(null)}
                className="-m-2 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary outline-none hover:text-fg-primary focus-visible:outline-2 focus-visible:outline-accent max-md:size-11"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </NotifyContext.Provider>
  );
}
