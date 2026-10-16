'use client';

import { useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { SubjectDto } from '@studyhub/contracts';
import { SelectionProvider } from '@/lib/selection';
import { materialHref } from '@/lib/subjectTabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EditSubjectForm } from '../EditSubjectForm';
import { fetchTopics } from '../DocumentList';
import { AssistantSheet } from './AssistantSheet';
import { fetchDocuments } from './queries';

/**
 * "Assistente" sheet plus the edit dialog for pages that do not go through `SubjectMobile` (the plan):
 * brings its own selection store and loads documents and topics only once opened.
 */
export function AssistantHost({
  slug,
  subject,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  slug: string;
  subject: SubjectDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The kebab button: gets the focus back when the sheet or the dialog closes. */
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const docs = useQuery({
    queryKey: ['documents', slug],
    queryFn: () => fetchDocuments(slug),
    enabled: open,
  });
  const topics = useQuery({
    queryKey: ['topics', slug],
    queryFn: () => fetchTopics(slug),
    enabled: open,
  });

  return (
    <SelectionProvider>
      <AssistantSheet
        open={open}
        onOpenChange={onOpenChange}
        returnFocusRef={returnFocusRef}
        slug={slug}
        subject={subject}
        documents={docs.data ?? []}
        topics={topics.data ?? []}
        loadState={{
          loading: docs.isPending,
          error: docs.isError ? (docs.error as Error).message : null,
          onRetry: () => void docs.refetch(),
        }}
        onPickMaterial={() => {
          onOpenChange(false);
          router.push(materialHref(slug, 'tutti'));
        }}
        onEdit={() => {
          onOpenChange(false);
          setEditing(true);
        }}
      />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent
          className="max-w-md"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Modifica materia</DialogTitle>
          </DialogHeader>
          <EditSubjectForm subject={subject} onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
    </SelectionProvider>
  );
}
