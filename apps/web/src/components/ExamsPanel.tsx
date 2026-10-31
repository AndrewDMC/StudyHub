'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExamDto, ExamProfileDto } from '@studyhub/contracts';
import { formatExamCountdown, formatRecurringTopic } from '@/lib/format';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { ProgressBar } from '@/components/subject-tabs/ProgressBar';
import { TabCard } from '@/components/subject-tabs/TabCard';
import { TabEmptyState } from '@/components/subject-tabs/TabEmptyState';
import { TabError, TabLoading } from '@/components/subject-tabs/TabState';
import { formatExamDuration } from '@/components/subject-tabs/format';
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  INPUT,
  LABEL,
  LINK_TEXT,
} from '@/components/subject-tabs/styles';
import { getJson } from './ExamPrepPanel';

export const KIND_LABELS: Record<ExamDto['kind'], string> = {
  scritto: 'Scritto',
  orale: 'Orale',
  parziale: 'Parziale',
  progetto: 'Progetto',
};

export async function fetchExams(slug: string): Promise<ExamDto[]> {
  const res = await fetch(`/api/subjects/${slug}/exams`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli esami');
  return body.exams as ExamDto[];
}

export interface CreateExamInput {
  title: string;
  kind: ExamDto['kind'];
  date: string;
  durationMin?: number;
  location?: string;
  allowedMaterials?: string;
}

export async function createExam(slug: string, input: CreateExamInput): Promise<ExamDto> {
  const res = await fetch(`/api/subjects/${slug}/exams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Creazione fallita');
  return body.exam as ExamDto;
}

export async function deleteExam(slug: string, id: string): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/exams/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Eliminazione fallita');
  }
}

const KIND_ORDER: Record<string, string> = {
  open: 'Domande aperte',
  mcq: 'Risposta multipla',
  numeric: 'Esercizi numerici',
  proof: 'Dimostrazioni',
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function ExamTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-inset p-3">
      <p className="text-xs uppercase tracking-[0.05em] text-fg-secondary">{label}</p>
      <p className="mt-1 break-words text-sm text-fg-primary">{children}</p>
    </div>
  );
}

function TeacherStyleCard({ subjectSlug }: { subjectSlug: string }) {
  const profileQuery = useQuery({
    queryKey: ['exam-profile', subjectSlug],
    queryFn: () =>
      getJson<ExamProfileDto | null>(`/api/subjects/${subjectSlug}/exam-profile`, 'profile'),
  });
  const profile = profileQuery.data;

  return (
    <TabCard label="Stile del docente" labelId="exam-teacher-style">
      {profileQuery.isLoading && <TabLoading rows={2} />}
      {profileQuery.isError && (
        <TabError
          message={(profileQuery.error as Error).message}
          onRetry={() => void profileQuery.refetch()}
        />
      )}
      {profileQuery.isSuccess && !profile && (
        <>
          <p className="text-sm text-fg-secondary">
            Nessun profilo d&apos;esame ancora. Si crea dalla tab Simulazioni.
          </p>
          <Link href={`/materie/${subjectSlug}?tab=simulazioni`} className={LINK_TEXT}>
            Vai a Simulazioni
          </Link>
        </>
      )}
      {profile && (
        <>
          <p className="text-[13px] text-fg-secondary">
            {profile.sourceDocIds.length === 1
              ? "Da 1 tema d'esame caricato"
              : `Da ${profile.sourceDocIds.length} temi d'esame caricati`}
          </p>
          <p className="font-mono text-xs text-fg-primary">
            {profile.profile.itemCount} esercizi · {profile.profile.durationMin} min ·{' '}
            {profile.profile.totalPoints} pt
          </p>
          <ul className="flex flex-col gap-3">
            {Object.entries(profile.profile.kindDistribution)
              .filter(([, v]) => (v ?? 0) > 0)
              .map(([k, v]) => {
                const ratio = v ?? 0;
                return (
                  <li key={k} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-fg-primary">{KIND_ORDER[k] ?? k}</span>
                      <span className="font-mono text-xs text-fg-secondary">
                        {Math.round(ratio * 100)}%
                      </span>
                    </div>
                    <ProgressBar ratio={ratio} tone="accent" />
                  </li>
                );
              })}
          </ul>
          {profile.profile.recurringTopics.length > 0 && (
            <p className="text-[13px] text-fg-secondary">
              Ricorrenti: {profile.profile.recurringTopics.map(formatRecurringTopic).join(', ')}
            </p>
          )}
        </>
      )}
    </TabCard>
  );
}

export function ExamsPanel({ subjectSlug }: { subjectSlug: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ExamDto['kind']>('scritto');
  const [date, setDate] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [allowedMaterials, setAllowedMaterials] = useState('');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['exams', subjectSlug],
    queryFn: () => fetchExams(subjectSlug),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['exams', subjectSlug] });

  const createMutation = useMutation({
    mutationFn: () =>
      createExam(subjectSlug, {
        title,
        kind,
        date: new Date(date).toISOString(),
        ...(durationMin ? { durationMin: Number(durationMin) } : {}),
        ...(allowedMaterials.trim() ? { allowedMaterials: allowedMaterials.trim() } : {}),
      }),
    onSuccess: (created) => {
      setTitle('');
      setDate('');
      setDurationMin('');
      setAllowedMaterials('');
      setDialogOpen(false);
      if (created?.id) setSelectedId(created.id);
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteExam(subjectSlug, id),
    onSuccess: invalidate,
  });

  const exams = query.data ?? [];
  const current = exams.find((e) => e.id === selectedId) ?? exams[0];

  const newExamButton = (variant: string) => (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => setDialogOpen(true)}
      className={variant}
    >
      <Plus aria-hidden="true" className="size-4" />
      Nuovo esame
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      {query.isLoading && <TabLoading rows={3} />}
      {query.isError && (
        <TabError message={(query.error as Error).message} onRetry={() => void query.refetch()} />
      )}
      {query.isSuccess && exams.length === 0 && (
        <TabEmptyState
          title="Nessun esame in programma"
          text="Aggiungi un esame per vedere il conto alla rovescia in alto."
          action={newExamButton(BTN_SECONDARY)}
        />
      )}
      {query.isSuccess && current && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              aria-label="Esami della materia"
              value={current.id}
              onChange={setSelectedId}
              className="flex-wrap"
              options={exams.map((exam) => ({
                value: exam.id,
                label: (
                  <>
                    <span className="max-w-[16ch] truncate">{exam.title}</span>
                    <span className="ml-2 text-fg-secondary">{KIND_LABELS[exam.kind]}</span>
                    <span className="ml-2 font-mono text-[11px] text-fg-secondary">
                      {shortDate(exam.date)}
                    </span>
                  </>
                ),
              }))}
            />
            {newExamButton(BTN_SECONDARY)}
          </div>
          <div className="grid grid-cols-1 gap-5 @2xl/tab:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <TabCard label="Com'è l'esame" labelId="exam-detail">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-base font-semibold text-fg-primary">
                    {current.title}
                  </p>
                  <span className="shrink-0 rounded-[var(--radius-control)] bg-bg-raised px-2 py-0.5 font-mono text-xs text-fg-primary">
                    {formatExamCountdown(current.date)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(current.id)}
                  disabled={deleteMutation.isPending}
                  aria-label={`Elimina ${current.title}`}
                  className={`${BTN_GHOST} hover:text-danger`}
                >
                  Elimina
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 @lg/tab:grid-cols-3">
                <ExamTile label="Data">
                  <span className="first-letter:uppercase">
                    {new Date(current.date).toLocaleDateString('it-IT', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </span>
                </ExamTile>
                <ExamTile label="Durata">{formatExamDuration(current.durationMin)}</ExamTile>
                <ExamTile label="Materiale ammesso">{current.allowedMaterials ?? '—'}</ExamTile>
              </div>
              {deleteMutation.isError && (
                <p role="alert" className="text-xs text-danger">
                  {(deleteMutation.error as Error).message}
                </p>
              )}
            </TabCard>
            <TeacherStyleCard subjectSlug={subjectSlug} />
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuovo esame</DialogTitle>
            <DialogDescription>
              Data, durata e materiale ammesso compaiono nel dettaglio dell&apos;esame.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim() && date) createMutation.mutate();
            }}
          >
            <label className={LABEL}>
              Titolo
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Titolo esame"
                className={INPUT}
              />
            </label>
            <label className={LABEL}>
              Tipo
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ExamDto['kind'])}
                className={INPUT}
              >
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              Data
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className={LABEL}>
              Durata in minuti
              <input
                type="number"
                min={1}
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className={LABEL}>
              Materiale ammesso
              <input
                value={allowedMaterials}
                onChange={(e) => setAllowedMaterials(e.target.value)}
                className={INPUT}
              />
            </label>
            {createMutation.isError && (
              <p role="alert" className="text-sm text-danger">
                {(createMutation.error as Error).message}
              </p>
            )}
            <DialogFooter>
              <button type="button" onClick={() => setDialogOpen(false)} className={BTN_GHOST}>
                Annulla
              </button>
              <button
                type="submit"
                disabled={!title.trim() || !date || createMutation.isPending}
                className={BTN_PRIMARY}
              >
                Crea esame
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
