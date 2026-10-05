'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentDeletionImpact, DocumentDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

async function fetchImpact(slug: string, documentId: string): Promise<DocumentDeletionImpact> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/impact`);
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(body?.error?.message ?? 'Impossibile valutare cosa verrebbe toccato');
  return body.impact as DocumentDeletionImpact;
}

async function deleteDocument(slug: string, documentId: string): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Eliminazione fallita');
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Elimina" on a document row: shows what the delete touches first, then moves it to `.trash/`. */
export function DeleteDocumentButton({
  subjectSlug,
  doc,
  onDeleted,
}: {
  subjectSlug: string;
  doc: DocumentDto;
  onDeleted?: (documentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const impactQuery = useQuery({
    queryKey: ['documentImpact', subjectSlug, doc.id],
    queryFn: () => fetchImpact(subjectSlug, doc.id),
    enabled: open,
    gcTime: 0, // counts must be fresh every time the dialog opens
  });

  const mutation = useMutation({
    mutationFn: () => deleteDocument(subjectSlug, doc.id),
    onSuccess: () => {
      setOpen(false);
      onDeleted?.(doc.id);
      queryClient.invalidateQueries({ queryKey: ['documents', subjectSlug] });
      queryClient.invalidateQueries({ queryKey: ['topics', subjectSlug] });
      queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
  });

  const impact = impactQuery.data;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          mutation.reset();
          setOpen(true);
        }}
        className="text-[11px] text-fg-muted underline-offset-2 hover:text-danger hover:underline"
      >
        Elimina
      </button>

      <Dialog open={open} onOpenChange={(next) => !mutation.isPending && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminare questo documento?</DialogTitle>
            <DialogDescription className="break-words">{doc.originalName}</DialogDescription>
          </DialogHeader>

          {impactQuery.isLoading && <p className="text-sm text-fg-muted">Controllo…</p>}
          {impactQuery.isError && (
            <p role="alert" className="text-sm text-danger">
              {(impactQuery.error as Error).message}
            </p>
          )}

          {impact && (
            <div className="space-y-3 text-sm text-fg-secondary">
              {impact.blockedReason ? (
                <p role="alert" className="text-warn">
                  {impact.blockedReason}
                </p>
              ) : (
                <>
                  <p>
                    Il file originale e il testo estratto vanno nel cestino della cartella dati (
                    <code className="font-mono text-xs">.trash/</code>): puoi recuperarli a mano.
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {impact.chunks > 0 && (
                      <li>
                        Sparisce dalla ricerca ({plural(impact.chunks, 'frammento', 'frammenti')}).
                      </li>
                    )}
                    {impact.topics.length > 0 && (
                      <li>
                        Viene scollegato dagli argomenti: {impact.topics.join(', ')} (la loro
                        padronanza viene ricalcolata).
                      </li>
                    )}
                    {(impact.artifacts.length > 0 || impact.flashcardsCiting > 0) && (
                      <li>
                        {plural(impact.flashcardsCiting, 'flashcard cita', 'flashcard citano')}{' '}
                        questo documento
                        {impact.artifacts.length > 0 &&
                          ` e ${plural(impact.artifacts.length, 'materiale generato lo usa', 'materiali generati lo usano')}`}
                        : restano dove sono (con la cronologia dei ripassi), ma il collegamento alla
                        fonte non funzionerà più.
                      </li>
                    )}
                    {impact.openTasks > 0 && (
                      <li className="text-warn">
                        {plural(impact.openTasks, 'task del piano usa', 'task del piano usano')}{' '}
                        questo documento: rigenera il piano dopo l&apos;eliminazione.
                      </li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          {mutation.isError && (
            <p role="alert" className="text-sm text-danger">
              {(mutation.error as Error).message}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => setOpen(false)}
            >
              Annulla
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={!impact?.deletable || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Elimino…' : 'Elimina'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
