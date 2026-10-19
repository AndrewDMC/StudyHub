'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RatingIntervals, ReviewOverviewDto, ReviewQueueItemDto } from '@studyhub/contracts';
import {
  DEFAULT_SESSION_LIMIT,
  applyServerResult,
  currentCard,
  isFinished,
  parseSessionLimit,
  rateCard,
  removeCard,
  replaceCard,
  lessonExitHref,
  scopeToSearchParams,
  sessionTitle,
  startSession,
  summarize,
  undoLast,
  type Confidence,
  type Rating,
  type ReviewScope,
  type SessionLimit,
  type SessionState,
} from '@/lib/quickReview';
import { fetchDeckSummaries } from '@/lib/deckEditorClient';
import { REVIEW_OVERVIEW_KEY, fetchReviewOverview } from '@/lib/reviewOverview';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { CardActionsSheet } from './CardActionsSheet';
import { QuickReviewHome } from './QuickReviewHome';
import { QuickReviewSession } from './QuickReviewSession';
import { QuickReviewSummary } from './QuickReviewSummary';
import { useReviewOutbox } from './useReviewOutbox';

const LIMIT_STORAGE_KEY = 'studyhub.quickReview.limit';

async function fetchQueue(scope: ReviewScope, limit: number): Promise<ReviewQueueItemDto[]> {
  const res = await fetch(`/api/review/queue?${scopeToSearchParams(scope, limit).toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Impossibile preparare la sessione');
  return body.queue as ReviewQueueItemDto[];
}

function readStoredLimit(): SessionLimit {
  try {
    return parseSessionLimit(window.localStorage.getItem(LIMIT_STORAGE_KEY));
  } catch {
    return DEFAULT_SESSION_LIMIT;
  }
}

// crypto.randomUUID needs a secure context, and the app is often opened over plain http on the LAN.
let keySeq = 0;
const nextKey = () => `${Date.now().toString(36)}-${(keySeq += 1)}`;

type Screen = 'home' | 'session' | 'summary';

/** Below `md` only (docs/09-ripasso-mobile.md §1.2): on desktop, the per-subject reviews. */
function DesktopNotice({ overview }: { overview: ReviewOverviewDto | undefined }) {
  return (
    <div className="mx-auto hidden max-w-xl flex-col gap-4 px-6 py-12 md:flex">
      <h1 className="text-xl font-semibold tracking-[-0.02em]">Ripasso rapido</h1>
      <p className="text-sm text-fg-secondary">
        Il ripasso rapido è pensato per il telefono. Da qui usa il ripasso di ogni materia, con le
        scorciatoie da tastiera.
      </p>
      {overview && overview.subjects.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-bg-surface">
          {overview.subjects
            .filter((subject) => subject.cardCount > 0)
            .map((subject) => (
              <li key={subject.slug}>
                <Link
                  href={`/materie/${subject.slug}/review`}
                  className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-bg-raised"
                >
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ background: SUBJECT_COLOR_HEX[subject.color] }}
                  />
                  <span className="flex-1">{subject.name}</span>
                  <span className="font-mono text-xs text-fg-secondary">
                    {subject.due} in scadenza
                  </span>
                </Link>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/**
 * `/ripasso` (docs/09-ripasso-mobile.md §C): home, session and summary in one client component.
 * Session and summary are a full-screen overlay over the shell; ratings are optimistic and go
 * out through `useReviewOutbox`.
 */
export function QuickReviewClient({
  deepLink,
}: {
  deepLink: { scope: ReviewScope; limit: number | null } | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: REVIEW_OVERVIEW_KEY, queryFn: fetchReviewOverview });
  const deepSlug = deepLink?.scope.subjectSlug;

  const [limit, setLimit] = useState<SessionLimit>(DEFAULT_SESSION_LIMIT);
  const [screen, setScreen] = useState<Screen>('home');
  const [scope, setScope] = useState<ReviewScope>(deepLink?.scope ?? {});
  // Deck names are not in the overview: read them from the decks list (cached by the subject page).
  const decks = useQuery({
    queryKey: ['decks', scope.subjectSlug],
    queryFn: () => fetchDeckSummaries(scope.subjectSlug!),
    enabled: !!scope.deckId && !!scope.subjectSlug,
  });
  const deckTitle = scope.deckId
    ? decks.data?.find((d) => d.id === scope.deckId)?.title
    : undefined;
  // The deep link's subject only while the current session is still that subject's.
  const linkSlug = deepSlug && scope.subjectSlug === deepSlug ? deepSlug : undefined;
  const [session, setSession] = useState<SessionState>(() => startSession([]));
  const [revealed, setRevealed] = useState(false);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  // Confidence given to each rated card (by rating key), restored when the rating is undone.
  const confidenceByKeyRef = useRef(new Map<string, Confidence>());
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const shownAtRef = useRef(Date.now());
  // Each card's intervals after its latest rating, for "Ripassa gli errori".
  const intervalsRef = useRef(new Map<string, RatingIntervals>());

  const refreshCounts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: REVIEW_OVERVIEW_KEY });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    if (linkSlug) {
      void queryClient.invalidateQueries({ queryKey: ['stats', linkSlug] });
      void queryClient.invalidateQueries({ queryKey: ['flashcard-stats', linkSlug] });
      void queryClient.invalidateQueries({ queryKey: ['flashcard-list', linkSlug] });
    }
  }, [queryClient, linkSlug]);

  const outbox = useReviewOutbox({
    onRated: (key, result) => {
      intervalsRef.current.set(result.flashcard.id, result.intervals);
      setSession((s) => applyServerResult(s, key, result));
    },
    onDrained: refreshCounts,
  });

  const begin = useCallback((queue: ReviewQueueItemDto[], nextScope: ReviewScope) => {
    setScope(nextScope);
    setSession(startSession(queue));
    setRevealed(false);
    setConfidence(null);
    setScreen('session');
    shownAtRef.current = Date.now();
  }, []);

  const start = useCallback(
    async (nextScope: ReviewScope, size: number = limit) => {
      setStarting(true);
      setStartError(null);
      try {
        const queue = await fetchQueue(nextScope, size);
        if (queue.length === 0)
          setStartError(
            nextScope.taskId
              ? 'Nessuna card da ripassare in questa lezione.'
              : 'Niente da ripassare qui per oggi.',
          );
        else begin(queue, nextScope);
      } catch (err) {
        setStartError((err as Error).message);
      } finally {
        setStarting(false);
      }
    },
    [begin, limit],
  );

  // Stored session length, then the `?materia=&argomento=&n=` deep link (once, also under
  // StrictMode's double effect).
  const deepLinkDone = useRef(false);
  useEffect(() => {
    const stored = readStoredLimit();
    setLimit(stored);
    if (deepLink && !deepLinkDone.current) {
      deepLinkDone.current = true;
      void start(deepLink.scope, deepLink.limit ?? stored);
    }
  }, []); // mount only

  const changeLimit = (value: SessionLimit) => {
    setLimit(value);
    try {
      window.localStorage.setItem(LIMIT_STORAGE_KEY, String(value));
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  };

  // The overlay covers the shell; this also hides the tab bar (MobileTabBar) underneath it.
  const overlayOpen = screen !== 'home';
  useEffect(() => {
    if (!overlayOpen) return;
    document.documentElement.dataset.fullscreen = '';
    return () => {
      delete document.documentElement.dataset.fullscreen;
    };
  }, [overlayOpen]);

  const finishExit = () => {
    setLeaving(false);
    setScreen('home');
    setSheetOpen(false);
    refreshCounts();
    const lessonHref = lessonExitHref(scope);
    if (lessonHref) router.replace(lessonHref, { scroll: false });
    else if (linkSlug) router.replace(`/materie/${linkSlug}?tab=flashcard`);
    else if (deepLink) router.replace('/ripasso', { scroll: false });
  };

  // Unsent ratings live only in memory: wait for the queue to drain before leaving; on an error
  // stay here with the toast and its "Riprova".
  const goHome = () => {
    if (outbox.status.error) return;
    if (outbox.status.pending > 0) setLeaving(true);
    else finishExit();
  };
  useEffect(() => {
    if (!leaving) return;
    if (outbox.status.error) setLeaving(false);
    else if (outbox.status.pending === 0) finishExit();
  }, [leaving, outbox.status.pending, outbox.status.error]);

  const rate = (rating: Rating) => {
    const card = currentCard(session);
    if (!card || !revealed) return;
    const now = Date.now();
    const key = nextKey();
    const elapsedMs = now - shownAtRef.current;
    const next = rateCard(session, { key, rating, ms: elapsedMs, now });
    outbox.rate({
      kind: 'rate',
      key,
      subjectSlug: card.subjectSlug,
      cardId: card.id,
      rating,
      elapsedMs,
      ...(confidence ? { confidence } : {}),
    });
    if (confidence) confidenceByKeyRef.current.set(key, confidence);
    setSession(next);
    setRevealed(false);
    setConfidence(null);
    shownAtRef.current = now;
    if (isFinished(next)) setScreen('summary');
  };

  const undo = () => {
    const undone = undoLast(session);
    if (!undone) return;
    outbox.undo(undone.entry.key);
    setSession(undone.state);
    setRevealed(true);
    setConfidence(confidenceByKeyRef.current.get(undone.entry.key) ?? null);
    confidenceByKeyRef.current.delete(undone.entry.key);
    setScreen('session');
    shownAtRef.current = Date.now();
  };

  const afterRemoval = (next: SessionState) => {
    setSession(next);
    setRevealed(false);
    setConfidence(null);
    shownAtRef.current = Date.now();
    if (isFinished(next)) {
      if (next.history.length) setScreen('summary');
      else goHome();
    }
  };

  const title = sessionTitle(scope, overview.data, deckTitle);
  const card = currentCard(session);
  const summary = screen === 'summary' ? summarize(session.history, Date.now()) : null;

  const retryErrors = () => {
    if (!summary) return;
    // The last copy of each card carries the freshest text; the intervals come from the server.
    const byId = new Map(session.queue.map((c) => [c.id, c]));
    const queue = summary.errorIds.flatMap((id) => {
      const c = byId.get(id);
      return c ? [{ ...c, intervals: intervalsRef.current.get(id) ?? c.intervals }] : [];
    });
    if (queue.length) begin(queue, scope);
    refreshCounts();
  };

  const toast = outbox.status.error
    ? { message: 'Valutazione non salvata', action: { label: 'Riprova', run: outbox.retry } }
    : outbox.status.rejected
      ? { message: outbox.status.rejected, action: { label: 'Ok', run: outbox.dismissRejected } }
      : null;

  return (
    <>
      <DesktopNotice overview={overview.data} />

      <div className="h-full md:hidden">
        <QuickReviewHome
          overview={overview.data}
          isLoading={overview.isLoading}
          error={overview.error}
          onRetry={() => void overview.refetch()}
          limit={limit}
          onLimitChange={changeLimit}
          onStart={(s) => void start(s)}
          starting={starting}
          startError={startError}
          backHref={
            lessonExitHref(scope) ?? (linkSlug ? `/materie/${linkSlug}?tab=flashcard` : undefined)
          }
        />
      </div>

      {overlayOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={screen === 'summary' ? 'Riepilogo sessione' : `Ripasso: ${title}`}
          key={screen}
          className="anim-screen-in fixed inset-0 z-50 flex flex-col bg-bg-base pt-[env(safe-area-inset-top)] text-fg-primary md:hidden"
        >
          {screen === 'session' && card ? (
            <>
              <QuickReviewSession
                title={title}
                card={card}
                position={Math.min(session.idx + 1, session.queue.length)}
                total={session.queue.length}
                done={session.idx}
                revealed={revealed}
                confidence={confidence}
                onConfidence={setConfidence}
                canUndo={session.history.length > 0}
                onReveal={() => setRevealed(true)}
                onRate={rate}
                onUndo={undo}
                onClose={goHome}
                onMore={() => setSheetOpen(true)}
              />
              <CardActionsSheet
                card={card}
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                onRemoved={(id) => afterRemoval(removeCard(session, id))}
                onEdited={(updated) => setSession((s) => replaceCard(s, updated))}
              />
            </>
          ) : summary ? (
            <QuickReviewSummary
              title={title}
              summary={summary}
              onRetryErrors={retryErrors}
              onHome={goHome}
              homePending={leaving}
              {...(scope.taskId
                ? { homeLabel: 'Torna alla lezione' }
                : linkSlug
                  ? { homeLabel: 'Torna alla materia' }
                  : {})}
            />
          ) : null}
        </div>
      )}

      {toast && (
        <div
          role="alert"
          className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+64px)] z-[70] flex items-center gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-bg-raised px-4 py-3 text-sm shadow-lg md:hidden"
        >
          <span className="flex-1 text-fg-primary">{toast.message}</span>
          <button
            type="button"
            onClick={toast.action.run}
            className="-my-2 h-11 px-2 font-medium text-accent"
          >
            {toast.action.label}
          </button>
        </div>
      )}
    </>
  );
}
