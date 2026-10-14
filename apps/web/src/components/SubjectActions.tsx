'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SubjectDto } from '@studyhub/contracts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EditSubjectForm } from './EditSubjectForm';

export function SubjectActions({ subject }: { subject: SubjectDto }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const isArchived = subject.archivedAt !== null;

  const archiveMutation = useMutation({
    mutationFn: async (archived: boolean) => {
      const res = await fetch(`/api/subjects/${subject.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Operazione fallita');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subject', subject.slug] });
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/subjects/${subject.slug}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Eliminazione fallita');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      router.push('/materie');
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modifica materia</DialogTitle>
          </DialogHeader>
          <EditSubjectForm subject={subject} onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-[var(--radius-control)] border border-border px-2.5 py-1 text-xs max-md:py-2 text-fg-secondary hover:text-fg-primary"
      >
        Modifica
      </button>

      <button
        type="button"
        onClick={() => archiveMutation.mutate(!isArchived)}
        disabled={archiveMutation.isPending}
        className="rounded-[var(--radius-control)] border border-border px-2.5 py-1 text-xs max-md:py-2 text-fg-secondary hover:text-fg-primary"
      >
        {isArchived ? 'Ripristina' : 'Archivia'}
      </button>

      {!confirmingDelete ? (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="rounded-[var(--radius-control)] border border-border px-2.5 py-1 text-xs max-md:py-2 text-danger hover:border-danger"
        >
          Elimina definitivamente
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-danger bg-bg-raised px-2.5 py-1 text-xs">
          <span className="text-fg-secondary">
            Sposta <code className="break-all font-mono">{subject.folderPath}</code> in{' '}
            <code className="font-mono">.trash/</code>. Confermi?
          </span>
          <button
            type="button"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="font-medium text-danger"
          >
            Sì, elimina
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="text-fg-muted"
          >
            Annulla
          </button>
        </div>
      )}

      {(archiveMutation.isError || deleteMutation.isError) && (
        <span role="alert" className="text-xs text-danger">
          {((archiveMutation.error ?? deleteMutation.error) as Error).message}
        </span>
      )}
    </div>
  );
}
