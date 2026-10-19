'use client';

import { useRef, type RefObject } from 'react';
import { X } from 'lucide-react';
import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useDeckSummaries } from '../api';
import { ICON_BTN } from '../shared/styles';
import { AiForm } from './AiForm';
import { ImportForm } from './ImportForm';
import { ManualForm } from './ManualForm';
import { NewDeckForm } from './NewDeckForm';

export type AddMode = 'manual' | 'ai' | 'import' | 'deck';

export interface AddDialogState {
  open: boolean;
  mode: AddMode;
}

const MODES: { mode: AddMode; title: string; text: string }[] = [
  { mode: 'manual', title: 'Scrivi a mano', text: 'Una card alla volta' },
  { mode: 'ai', title: "Genera con l'AI", text: 'Dai documenti della materia' },
  { mode: 'import', title: 'Importa', text: 'Da Anki o da un CSV' },
  { mode: 'deck', title: 'Nuovo mazzo vuoto', text: 'Da riempire più tardi' },
];

/** The single entry point for adding flashcards: four modes in one dialog (full screen on phones). */
export function AddFlashcardsDialog({
  slug,
  state,
  onStateChange,
  returnFocusRef,
  topics,
  documents,
  defaultTopicId = '',
  defaultDeckId = '',
}: {
  slug: string;
  state: AddDialogState;
  onStateChange: (state: AddDialogState) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  topics: TopicDto[];
  documents: DocumentDto[];
  defaultTopicId?: string;
  defaultDeckId?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const decksQuery = useDeckSummaries(slug);
  const decks = decksQuery.data ?? [];
  const close = () => onStateChange({ ...state, open: false });
  const setMode = (mode: AddMode) => onStateChange({ open: true, mode });

  return (
    <Dialog open={state.open} onOpenChange={(open) => onStateChange({ ...state, open })}>
      <DialogContent
        ref={contentRef}
        hideClose
        aria-labelledby="fc-add-title"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          contentRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusRef.current?.focus();
        }}
        className="w-[calc(100%-2rem)] max-w-[820px] overflow-hidden p-0 max-md:inset-0 max-md:left-0 max-md:top-0 max-md:h-dvh max-md:max-h-none max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:overflow-y-auto max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top)]"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <DialogTitle id="fc-add-title" className="text-lg font-semibold">
            Aggiungi flashcard
          </DialogTitle>
          <button type="button" aria-label="Chiudi" onClick={close} className={ICON_BTN}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <DialogDescription className="sr-only">
          Scegli come aggiungere le flashcard alla materia.
        </DialogDescription>
        <div className="flex flex-wrap max-md:flex-col">
          <div
            role="group"
            aria-label="Come vuoi aggiungerle"
            className="flex flex-1 basis-60 flex-col gap-1 border-r border-border bg-bg-inset p-4 max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:border-b max-md:border-r-0"
          >
            {MODES.map((m) => {
              const active = state.mode === m.mode;
              return (
                <button
                  key={m.mode}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMode(m.mode)}
                  className={`min-h-14 rounded-lg border px-3.5 py-3 text-left outline-none focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-12 max-md:py-2 ${
                    active
                      ? 'border-accent/40 bg-accent-subtle'
                      : 'border-transparent hover:bg-bg-raised'
                  }`}
                >
                  <span className="block text-sm font-medium">{m.title}</span>
                  <span className="block text-[13px] text-fg-secondary max-md:hidden">
                    {m.text}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-4 p-6">
            {state.mode === 'manual' && (
              <ManualForm
                slug={slug}
                topics={topics}
                decks={decks}
                decksLoading={decksQuery.isLoading}
                defaultTopicId={defaultTopicId}
                defaultDeckId={defaultDeckId}
                onClose={close}
                onNeedDeck={() => setMode('deck')}
              />
            )}
            {state.mode === 'ai' && (
              <AiForm slug={slug} documents={documents} topics={topics} onClose={close} />
            )}
            {state.mode === 'import' && <ImportForm slug={slug} decks={decks} onClose={close} />}
            {state.mode === 'deck' && <NewDeckForm slug={slug} onClose={close} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
