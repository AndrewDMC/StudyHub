'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import type { DocumentDto, StudySessionDto } from '@studyhub/contracts';
import { GenerateFlashcardsSheet } from './GenerateFlashcardsSheet';

async function startSessionOnTopics(slug: string, topicIds: string[]): Promise<StudySessionDto> {
  const res = await fetch(`/api/subjects/${slug}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicIds }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Impossibile avviare la sessione');
  return body.session as StudySessionDto;
}

/** Bottom CTAs of Documento: generate flashcards from this document, or study its topics now. */
export function DocumentCtas({ slug, doc }: { slug: string; doc: DocumentDto }) {
  const router = useRouter();
  const hintId = useId();
  const [generating, setGenerating] = useState(false);
  const generateRef = useRef<HTMLButtonElement>(null);
  const ready = doc.status === 'parsed';
  const noTopics = doc.topicIds.length === 0;

  const study = useMutation({
    mutationFn: () => startSessionOnTopics(slug, doc.topicIds),
    onSuccess: (session) => router.push(`/materie/${slug}/sessione/${session.id}`),
  });

  return (
    <div className="pb-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          ref={generateRef}
          type="button"
          aria-haspopup="dialog"
          disabled={!ready}
          onClick={() => setGenerating(true)}
          className="min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-bg-raised text-sm font-medium disabled:opacity-50"
        >
          Genera flashcard
        </button>
        <button
          type="button"
          disabled={!ready || noTopics || study.isPending}
          aria-describedby={noTopics ? hintId : undefined}
          onClick={() => study.mutate()}
          className="min-h-11 rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
        >
          {study.isPending ? 'Avvio…' : 'Studialo ora'}
        </button>
      </div>
      {noTopics && (
        <p id={hintId} className="mt-2 text-[13px] text-fg-muted">
          Collega il documento a un argomento per studiarlo ora.
        </p>
      )}
      {study.isError && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {(study.error as Error).message}
        </p>
      )}
      <GenerateFlashcardsSheet
        open={generating}
        onOpenChange={setGenerating}
        slug={slug}
        doc={doc}
        returnFocusRef={generateRef}
      />
    </div>
  );
}
