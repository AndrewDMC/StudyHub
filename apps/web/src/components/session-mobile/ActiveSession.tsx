'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import type { SessionFocus, StudySessionDto, UpdateSessionRequest } from '@studyhub/contracts';
import { SessionLessonCards } from '../task-flashcards/SessionLessonCards';
import { BriefingMobile } from './BriefingMobile';
import { ChatMobile } from './ChatMobile';
import { SourceSheet, type SourceRef } from './SourceSheet';
import { TopicsSheet } from './TopicsSheet';

type Tab = 'brief' | 'chat';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'brief', label: 'Punti chiave ed esercizi' },
  { id: 'chat', label: 'Chiedi all’AI' },
];

/** The body of an active session: two tabs (briefing / chat) and the sheets they open. */
export function ActiveSession({
  slug,
  sessionId,
  session,
  patchTopics,
}: {
  slug: string;
  sessionId: string;
  session: StudySessionDto;
  patchTopics: {
    mutate: (patch: UpdateSessionRequest) => void;
    isPending: boolean;
    error: Error | null;
    reset: () => void;
  };
}) {
  const [tab, setTab] = useState<Tab>('brief');
  // Once opened the chat stays mounted (hidden): a streaming answer and the typed text survive a tab switch.
  const [chatMounted, setChatMounted] = useState(false);
  const [focus, setFocus] = useState<SessionFocus | null>(null);
  const [source, setSource] = useState<SourceRef | null>(null);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const sourceReturnRef = useRef<HTMLElement | null>(null);
  const topicsRef = useRef<HTMLButtonElement | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ brief: null, chat: null });

  const select = (next: Tab) => {
    setTab(next);
    if (next === 'chat') setChatMounted(true);
  };
  const onTabKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: Tab = tab === 'brief' ? 'chat' : 'brief';
    select(next);
    tabRefs.current[next]?.focus();
  };
  const openSource = (next: SourceRef, trigger: HTMLElement) => {
    sourceReturnRef.current = trigger;
    setSource(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Contenuto della sessione"
        onKeyDown={onTabKeyDown}
        className="m-4 mb-0 grid shrink-0 grid-cols-2 gap-1 rounded-[10px] border border-border bg-bg-inset p-1"
      >
        {TABS.map(({ id, label }) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={selected}
              aria-controls={`panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(id)}
              className={`min-h-11 rounded-[7px] px-2 text-[13px] font-medium ${
                selected
                  ? 'bg-bg-raised text-fg-primary shadow-[0_0_0_1px_var(--border-strong)]'
                  : 'text-fg-secondary'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {
        <div
          role="tabpanel"
          id="panel-brief"
          aria-labelledby="tab-brief"
          hidden={tab !== 'brief'}
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4"
        >
          <SessionLessonCards slug={slug} taskId={session.taskId} variant="mobile" />
          <BriefingMobile
            slug={slug}
            sessionId={sessionId}
            session={session}
            onSource={openSource}
            onAsk={(next) => {
              setFocus(next);
              select('chat');
            }}
            onOpenTopics={() => {
              patchTopics.reset();
              setTopicsOpen(true);
            }}
            topicsRef={topicsRef}
          />
        </div>
      }
      {chatMounted && (
        <div
          role="tabpanel"
          id="panel-chat"
          aria-labelledby="tab-chat"
          hidden={tab !== 'chat'}
          className="min-h-0 flex-1"
        >
          <ChatMobile
            slug={slug}
            sessionId={sessionId}
            session={session}
            focus={focus}
            onClearFocus={() => setFocus(null)}
            onSource={openSource}
            visible={tab === 'chat'}
          />
        </div>
      )}

      <SourceSheet
        slug={slug}
        source={source}
        onOpenChange={(open) => {
          if (!open) setSource(null);
        }}
        returnFocusRef={sourceReturnRef}
      />
      <TopicsSheet
        slug={slug}
        session={session}
        open={topicsOpen}
        onOpenChange={setTopicsOpen}
        pending={patchTopics.isPending}
        error={patchTopics.error?.message ?? null}
        onChange={(topicIds) => patchTopics.mutate({ topicIds })}
        returnFocusRef={topicsRef}
      />
    </div>
  );
}
