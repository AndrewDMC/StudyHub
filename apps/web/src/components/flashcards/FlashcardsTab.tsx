'use client';

import { useRef, useState } from 'react';
import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { AddFlashcardsDialog, type AddDialogState, type AddMode } from './add/AddFlashcardsDialog';
import { CardsView } from './cards/CardsView';
import { NotifierProvider } from './Notifier';
import { OverviewView } from './overview/OverviewView';
import { StatsView } from './stats/StatsView';
import { TabActions } from './TabActions';
import { useFlashcardsParams } from './useFlashcardsParams';
import { ViewSwitcher } from './ViewSwitcher';

function Inner({
  slug,
  topics,
  documents,
}: {
  slug: string;
  topics: TopicDto[];
  documents: DocumentDto[];
}) {
  const { params, href, replace } = useFlashcardsParams(slug);
  const addRef = useRef<HTMLButtonElement>(null);
  const [add, setAdd] = useState<AddDialogState>({ open: false, mode: 'manual' });
  const openAdd = (mode: AddMode) => setAdd({ open: true, mode });

  return (
    <div className="@container/fc flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewSwitcher view={params.view} href={href} />
        <TabActions
          slug={slug}
          view={params.view}
          addRef={addRef}
          onAdd={() => openAdd('manual')}
        />
      </div>

      {params.view === 'panoramica' && (
        <OverviewView
          slug={slug}
          topics={topics}
          group={params.group}
          onGroupChange={(group) => replace({ group })}
          onAdd={openAdd}
        />
      )}
      {params.view === 'card' && <CardsView slug={slug} topics={topics} onAdd={openAdd} />}
      {params.view === 'statistiche' && <StatsView slug={slug} />}

      <AddFlashcardsDialog
        slug={slug}
        state={add}
        onStateChange={setAdd}
        returnFocusRef={addRef}
        topics={topics}
        documents={documents}
        defaultTopicId={params.argomento && params.argomento !== 'none' ? params.argomento : ''}
        defaultDeckId={params.mazzo ?? ''}
      />
    </div>
  );
}

/** Desktop root of the Flashcard tab: view switcher, actions, the active view and the add dialog. */
export function FlashcardsTab(props: {
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
