'use client';

import { useEffect, useRef, useState } from 'react';
import { SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import { ActiveSession } from './ActiveSession';
import { ClosingMobile } from './ClosingMobile';
import { EndSheet } from './EndSheet';
import { SessionHeader } from './SessionHeader';
import { TimerSheet } from './TimerSheet';
import { TimerStrip } from './TimerStrip';
import { useSessionRun } from './useSessionRun';

/**
 * Full-screen mobile flow of a study session (below md): the active session (timer, briefing, chat)
 * and, once it is over, the closing. The desktop page is `SessionDesktop`; only one branch is mounted.
 */
export function SessionMobile({ slug, sessionId }: { slug: string; sessionId: string }) {
  const run = useSessionRun(slug, sessionId);
  const { session, query, active, timer, shownMs, patchTopics, end, tasks } = run;
  const [endOpen, setEndOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const endRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<HTMLButtonElement>(null);

  // Hides the tab bar (the global header goes via AppShell): the session is a full screen.
  useEffect(() => {
    document.documentElement.dataset.fullscreen = '';
    return () => {
      delete document.documentElement.dataset.fullscreen;
    };
  }, []);

  if (query.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-bg-base">
        <SessionHeader slug={slug} />
        <div aria-busy="true" className="p-4">
          <SkeletonRows count={3} />
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-bg-base">
        <SessionHeader slug={slug} />
        <div className="p-4">
          <SectionError
            message={(query.error as Error | null)?.message ?? 'Impossibile caricare la sessione'}
            onRetry={() => void query.refetch()}
          />
        </div>
      </div>
    );
  }

  if (!active) {
    return (
      <ClosingMobile
        slug={slug}
        sessionId={sessionId}
        session={session}
        sessionKey={run.sessionKey}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base">
      <SessionHeader
        slug={slug}
        session={session}
        tasks={tasks.data}
        endDisabled={end.isPending}
        onEnd={() => {
          end.reset();
          setEndOpen(true);
        }}
        endRef={endRef}
      />
      <TimerStrip timer={timer} onOpenSettings={() => setTimerOpen(true)} settingsRef={timerRef} />
      <ActiveSession
        slug={slug}
        sessionId={sessionId}
        session={session}
        patchTopics={patchTopics}
      />
      <TimerSheet
        open={timerOpen}
        onOpenChange={setTimerOpen}
        timer={timer}
        returnFocusRef={timerRef}
      />
      <EndSheet
        open={endOpen}
        onOpenChange={setEndOpen}
        shownMs={shownMs}
        pending={end.isPending}
        error={end.isError ? (end.error as Error).message : null}
        onConfirm={() => end.mutate()}
        returnFocusRef={endRef}
      />
    </div>
  );
}
