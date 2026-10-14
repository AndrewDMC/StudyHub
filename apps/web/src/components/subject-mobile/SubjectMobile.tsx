'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import type {
  DocumentDto,
  ExamDto,
  FlashcardStatsDto,
  SubjectDto,
  TopicDto,
} from '@studyhub/contracts';
import { materialHref, type MaterialFilter, type MobileTab } from '@/lib/subjectTabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EditSubjectForm } from '../EditSubjectForm';
import { SearchPanel } from '../SearchPanel';
import { MobileHeader } from './MobileHeader';
import { MobileTabs } from './MobileTabs';
import { MobileOverview } from './MobileOverview';
import { MobileMaterial } from './MobileMaterial';
import { MobileTabContent } from './MobileTabContent';
import { AssistantSheet } from './AssistantSheet';

/** The subject page below md (docs/design/materia-mobile): header, six tabs, content, assistant FAB. */
export function SubjectMobile({
  slug,
  subject,
  documents,
  topics,
  topicsLoaded,
  stats,
  flashcardTotal,
  nextExam,
  tab,
  filter,
  fakeProvider,
}: {
  slug: string;
  subject: SubjectDto;
  documents: DocumentDto[];
  topics: TopicDto[];
  topicsLoaded: boolean;
  stats: FlashcardStatsDto | undefined;
  flashcardTotal: number | null;
  nextExam: ExamDto | undefined;
  tab: MobileTab;
  filter: MaterialFilter;
  fakeProvider: boolean;
}) {
  const router = useRouter();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const searchRegionId = useId();
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  // Whoever opened the sheet (kebab or FAB) gets the focus back when it closes.
  const sheetTriggerRef = useRef<HTMLElement | null>(null);
  const searchRegionRef = useRef<HTMLDivElement>(null);
  const searchWasOpen = useRef(false);

  // Focus moves into the search field on open and back to its button on close.
  useEffect(() => {
    if (searchOpen) {
      searchRegionRef.current?.querySelector('input')?.focus();
    } else if (searchWasOpen.current) {
      searchButtonRef.current?.focus();
    }
    searchWasOpen.current = searchOpen;
  }, [searchOpen]);

  return (
    <div className="flex min-h-full min-w-0 flex-col overflow-x-clip">
      <div className="sticky top-0 z-10 bg-bg-surface pt-[env(safe-area-inset-top)]">
        <MobileHeader
          subject={subject}
          searchOpen={searchOpen}
          searchRegionId={searchRegionId}
          onToggleSearch={() => setSearchOpen((v) => !v)}
          onOpenActions={() => {
            sheetTriggerRef.current = actionsButtonRef.current;
            setActionsOpen(true);
          }}
          searchButtonRef={searchButtonRef}
          actionsButtonRef={actionsButtonRef}
        />
        {searchOpen && (
          <div
            id={searchRegionId}
            ref={searchRegionRef}
            className="px-4 pb-1"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchOpen(false);
            }}
          >
            <SearchPanel subjectSlug={slug} />
          </div>
        )}
        <MobileTabs slug={slug} activeTab={tab} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-6 p-4">
        {tab === 'panoramica' && (
          <MobileOverview
            slug={slug}
            documentCount={documents.length}
            topicCount={topicsLoaded ? topics.length : null}
            flashcardTotal={flashcardTotal}
            nextExam={nextExam}
            stats={stats}
            fakeProvider={fakeProvider}
          />
        )}
        {tab === 'materiale' && (
          <MobileMaterial slug={slug} filter={filter} documents={documents} />
        )}
        {(tab === 'flashcard' || tab === 'simulazioni' || tab === 'lacune') && (
          <MobileTabContent slug={slug} tab={tab} documents={documents} topics={topics} />
        )}

        <button
          type="button"
          aria-haspopup="dialog"
          ref={fabRef}
          onClick={() => {
            sheetTriggerRef.current = fabRef.current;
            setActionsOpen(true);
          }}
          className="sticky bottom-4 ml-auto mt-auto flex min-h-[52px] items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-bg-base shadow-lg"
        >
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
          Assistente
        </button>
      </div>

      <AssistantSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        returnFocusRef={sheetTriggerRef}
        slug={slug}
        subject={subject}
        documents={documents}
        topics={topics}
        onPickMaterial={() => {
          setActionsOpen(false);
          router.replace(materialHref(slug, 'tutti'), { scroll: false });
        }}
        onEdit={() => {
          setActionsOpen(false);
          setEditing(true);
        }}
      />

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent
          className="max-w-md"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            actionsButtonRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Modifica materia</DialogTitle>
          </DialogHeader>
          <EditSubjectForm subject={subject} onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
