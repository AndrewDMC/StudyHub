'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Pencil } from 'lucide-react';
import { documentStatusView, documentTypeLabel } from '@/lib/documentStatus';
import { materialFilterForType, materialHref } from '@/lib/subjectTabs';
import { ObsidianMarkdown } from '../ObsidianMarkdown';
import { DeleteDocumentButton } from '../DeleteDocumentButton';
import { fetchContent, saveContent } from '../DocumentContentClient';
import { fetchTopics } from '../DocumentList';
import { SectionError } from '../subject-mobile/SectionState';
import { ConflictBanner } from './ConflictBanner';
import { DocHeader, iconButton } from './DocHeader';
import { DocumentActionsSheet } from './DocumentActionsSheet';
import { DocumentCtas } from './DocumentCtas';
import { DocumentStatusPanel } from './DocumentStatusPanel';
import { DocumentViewSwitch } from './DocumentViewSwitch';
import { StatusPill } from './StatusPill';
import { TopicPickerSheet } from './TopicPickerSheet';
import { useDocument, useSubjectName } from './queries';

const pillClass = 'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs';

/** Documento (docs/design/materia-mobile/Documento.dc.html): extracted text, topics, CTAs. */
export function DocumentMobile({
  subjectSlug: slug,
  documentId,
}: {
  subjectSlug: string;
  documentId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const subjectName = useSubjectName(slug);
  const docQuery = useDocument(slug, documentId);
  const doc = docQuery.data;

  const topicsQuery = useQuery({
    queryKey: ['topics', slug],
    queryFn: () => fetchTopics(slug),
    enabled: !!doc,
  });
  const hasMd = !!doc && doc.status === 'parsed' && !!doc.mdPath;
  const contentQuery = useQuery({
    queryKey: ['documentContent', slug, documentId],
    queryFn: () => fetchContent(slug, documentId),
    enabled: hasMd,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const topicsRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
    else if (wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const saveMutation = useMutation({
    mutationFn: (markdown: string) => saveContent(slug, documentId, markdown),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['documentContent', slug, documentId] });
      queryClient.invalidateQueries({ queryKey: ['documents', slug] });
    },
  });

  const backHref = materialHref(slug, doc ? materialFilterForType(doc.type) : 'tutti');
  const content = contentQuery.data;
  const canEdit = hasMd && !!content && !content.conflict && !editing;

  const header = (
    <DocHeader
      backHref={backHref}
      title={doc?.originalName}
      subtitle={subjectName}
      actions={
        doc && (
          <>
            {canEdit && (
              <button
                ref={editRef}
                type="button"
                aria-label="Modifica il testo"
                onClick={() => {
                  setDraft(content!.markdown);
                  saveMutation.reset();
                  setEditing(true);
                }}
                className={iconButton}
              >
                <Pencil className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
            <button
              ref={kebabRef}
              type="button"
              aria-label="Altre azioni sul documento"
              aria-haspopup="dialog"
              onClick={() => setActionsOpen(true)}
              className={iconButton}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        )
      }
    />
  );

  if (docQuery.isError || (!docQuery.isLoading && !doc)) {
    return (
      <div className="flex min-h-full min-w-0 flex-col">
        {header}
        <div className="space-y-3 p-4">
          <SectionError message="Documento non trovato." onRetry={() => docQuery.refetch()} />
          <Link href={backHref} className="flex min-h-11 items-center text-sm text-accent">
            Torna al materiale
          </Link>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex min-h-full min-w-0 flex-col">
        {header}
        <div aria-busy="true" className="space-y-3 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-4 animate-pulse rounded bg-bg-raised"
              style={{ width: `${95 - (i % 3) * 12}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  const view = documentStatusView(doc);
  const topics = topicsQuery.data ?? [];
  const linkedTopics = topics.filter((t) => doc.topicIds.includes(t.id));
  const typeLine = `${documentTypeLabel(doc)}${doc.pages !== null ? ` · ${doc.pages} ${doc.pages === 1 ? 'pagina' : 'pagine'}` : ''}`;
  const showText = hasMd;

  return (
    <div className="flex min-h-full min-w-0 flex-col overflow-x-clip">
      {header}
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-4">
        <div className="flex">
          <DocumentViewSwitch slug={slug} documentId={documentId} active="testo" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill view={view} />
          <span className={`${pillClass} border-border text-fg-secondary`}>{typeLine}</span>
          {linkedTopics.map((t) => (
            <span
              key={t.id}
              className={`${pillClass} border-accent bg-accent-subtle text-fg-primary`}
            >
              {t.name}
            </span>
          ))}
          <button
            ref={topicsRef}
            type="button"
            aria-haspopup="dialog"
            onClick={() => setTopicsOpen(true)}
            className="-my-2 flex min-h-11 shrink-0 items-center"
          >
            <span className={`${pillClass} border-dashed border-border-strong text-fg-secondary`}>
              + Argomento
            </span>
          </button>
        </div>

        {showText && content?.conflict && (
          <ConflictBanner
            slug={slug}
            documentId={documentId}
            mine={content.markdown}
            theirs={content.conflict.newMarkdown}
          />
        )}

        {!showText && (
          <DocumentStatusPanel slug={slug} doc={doc} onDelete={() => setDeleteOpen(true)} />
        )}

        {showText && contentQuery.isLoading && (
          <div aria-busy="true" className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className="h-4 animate-pulse rounded bg-bg-raised"
                style={{ width: `${95 - (i % 3) * 12}%` }}
              />
            ))}
          </div>
        )}
        {showText && contentQuery.isError && (
          <SectionError
            message={(contentQuery.error as Error).message}
            onRetry={() => contentQuery.refetch()}
          />
        )}

        {showText && content && !editing && (
          <div className="min-w-0 break-words text-base leading-[1.65] [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
            <ObsidianMarkdown source={content.markdown} subjectSlug={slug} />
          </div>
        )}

        {showText && content && editing && (
          <div className="flex flex-col gap-2">
            <textarea
              ref={textareaRef}
              aria-label="Testo del documento"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[60dvh] w-full rounded-[var(--radius-card)] border border-border bg-bg-inset p-3 font-mono text-sm text-fg-primary outline-none focus:border-accent"
            />
            {saveMutation.isError && (
              <p role="alert" className="text-[13px] text-danger">
                {(saveMutation.error as Error).message}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate(draft)}
                className="min-h-11 flex-1 rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Salvo…' : 'Salva'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-border-strong text-sm"
              >
                Annulla
              </button>
            </div>
          </div>
        )}

        {showText && !editing && <DocumentCtas slug={slug} doc={doc} />}
      </main>

      <TopicPickerSheet
        open={topicsOpen}
        onOpenChange={setTopicsOpen}
        slug={slug}
        doc={doc}
        topics={topics}
        returnFocusRef={topicsRef}
      />
      <DocumentActionsSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        slug={slug}
        doc={doc}
        returnFocusRef={kebabRef}
        onDelete={() => {
          setActionsOpen(false);
          setDeleteOpen(true);
        }}
      />
      <DeleteDocumentButton
        subjectSlug={slug}
        doc={doc}
        hideTrigger
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => router.replace(backHref)}
      />
    </div>
  );
}
