'use client';

import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import {
  AddFlashcardsDialog,
  type AddDialogState,
  type AddMode,
} from '../flashcards/add/AddFlashcardsDialog';
import { NotifierProvider } from '../flashcards/Notifier';
import { StatsView } from '../flashcards/stats/StatsView';
import { useFlashcardsParams } from '../flashcards/useFlashcardsParams';
import { ViewSwitcher } from '../flashcards/ViewSwitcher';
import { CardsSection } from './CardsSection';
import { MobileOverview } from './MobileOverview';

function Inner({
  slug,
  topics,
  documents,
}: {
  slug: string;
  topics: TopicDto[];
  documents: DocumentDto[];
}) {
  const { params, href } = useFlashcardsParams(slug);
  const fabRef = useRef<HTMLButtonElement>(null);
  const [add, setAdd] = useState<AddDialogState>({ open: false, mode: 'manual' });
  const openAdd = (mode: AddMode) => setAdd({ open: true, mode });

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4 pb-[calc(env(safe-area-inset-bottom)+88px)]">
        <ViewSwitcher mobile view={params.view} href={href} />
        {params.view === 'panoramica' && (
          <MobileOverview slug={slug} topics={topics} onAdd={openAdd} />
        )}
        {params.view === 'card' && <CardsSection slug={slug} topics={topics} onAdd={openAdd} />}
        {params.view === 'statistiche' && <StatsView slug={slug} mobile />}
      </div>
      {!add.open && (
        <button
          ref={fabRef}
          type="button"
          aria-label="Aggiungi flashcard"
          aria-haspopup="dialog"
          onClick={() => openAdd('manual')}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+24px)] right-4 z-40 flex size-14 items-center justify-center rounded-2xl border border-border-strong bg-bg-raised text-fg-primary shadow-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Plus className="size-[22px]" aria-hidden="true" />
        </button>
      )}
      <AddFlashcardsDialog
        slug={slug}
        state={add}
        onStateChange={setAdd}
        returnFocusRef={fabRef}
        topics={topics}
        documents={documents}
        defaultTopicId={params.argomento && params.argomento !== 'none' ? params.argomento : ''}
        defaultDeckId={params.mazzo ?? ''}
      />
    </>
  );
}

/** Tab Flashcard below md: same views and URL params as desktop, with a FAB for "Aggiungi flashcard". */
export function FlashcardMobile(props: {
  slug: string;
  topics: TopicDto[];
  documents: DocumentDto[];
}) {
  return (
    <NotifierProvider>
      <Inner {...props} />
    </NotifierProvider>
  );
}
