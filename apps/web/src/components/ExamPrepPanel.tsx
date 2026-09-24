'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExamProfileDto, SimulationSummaryDto, TopicDto } from '@studyhub/contracts';

async function getJson<T>(url: string, key: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Caricamento fallito');
  return body[key] as T;
}

async function postJson(url: string, payload: unknown, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Operazione fallita');
  return body;
}

const KIND_LABELS = {
  open: 'aperte',
  mcq: 'multiple',
  numeric: 'numeriche',
  proof: 'dimostrazioni',
} as const;

function ProfileEditor({
  slug,
  profile,
  onDone,
}: {
  slug: string;
  profile: ExamProfileDto;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(profile.profile);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => postJson(`/api/subjects/${slug}/exam-profile`, draft, 'PATCH'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-profile', slug] });
      onDone();
    },
  });
  const num = (
    key: 'itemCount' | 'durationMin' | 'totalPoints' | 'avgMinutesPerItem',
    label: string,
  ) => (
    <label className="flex items-center justify-between gap-2 text-xs text-fg-secondary">
      {label}
      <input
        type="number"
        min={1}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
        className="w-20 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-0.5 text-right font-mono text-xs text-fg-primary"
      />
    </label>
  );
  return (
    <div className="space-y-1.5">
      {num('itemCount', 'Esercizi')}
      {num('durationMin', 'Durata (min)')}
      {num('totalPoints', 'Punti totali')}
      {num('avgMinutesPerItem', 'Min per esercizio')}
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        Note
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          rows={2}
          className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary"
        />
      </label>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-[var(--radius-control)] bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover"
        >
          Salva
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-fg-muted hover:text-fg-secondary"
        >
          Annulla
        </button>
      </div>
      {save.isError && (
        <p role="alert" className="text-xs text-danger">
          {(save.error as Error).message}
        </p>
      )}
    </div>
  );
}

/** Exams & simulations (docs/fasi/F5-esami-simulazioni.md) on the subject page. */
export function ExamPrepPanel({ subjectSlug }: { subjectSlug: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [drillTopic, setDrillTopic] = useState('');

  const profileQuery = useQuery({
    queryKey: ['exam-profile', subjectSlug],
    queryFn: () =>
      getJson<ExamProfileDto | null>(`/api/subjects/${subjectSlug}/exam-profile`, 'profile'),
  });
  const simsQuery = useQuery({
    queryKey: ['simulations', subjectSlug],
    queryFn: () =>
      getJson<SimulationSummaryDto[]>(`/api/subjects/${subjectSlug}/simulations`, 'simulations'),
  });
  const topicsQuery = useQuery({
    queryKey: ['topics', subjectSlug],
    queryFn: () => getJson<TopicDto[]>(`/api/subjects/${subjectSlug}/topics`, 'topics'),
  });

  const refreshSoon = (key: string) =>
    setTimeout(() => queryClient.invalidateQueries({ queryKey: [key, subjectSlug] }), 3000);

  const extract = useMutation({
    mutationFn: () => postJson(`/api/subjects/${subjectSlug}/exam-profile`, {}),
    onSuccess: () => refreshSoon('exam-profile'),
  });
  const generate = useMutation({
    mutationFn: (payload: { mode: 'esame_completo' | 'drill_argomento'; topicId?: string }) =>
      postJson(`/api/subjects/${subjectSlug}/simulations`, payload),
    onSuccess: () => refreshSoon('simulations'),
  });

  const profile = profileQuery.data;
  const error = extract.error ?? generate.error;

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Simulazioni d&apos;esame
      </h2>

      <div className="space-y-2 px-1 text-xs">
        {profileQuery.isLoading && <p className="text-fg-muted">Caricamento…</p>}
        {profileQuery.isError && (
          <p role="alert" className="text-danger">
            {(profileQuery.error as Error).message}
          </p>
        )}
        {profileQuery.isSuccess && !profile && (
          <p className="text-fg-muted">
            Nessun profilo d&apos;esame. Carica gli esami passati come tipo &quot;Esami&quot;, poi
            estrai il profilo.
          </p>
        )}
        {profile && !editing && (
          <div className="space-y-1 text-fg-secondary">
            <p className="font-mono tabular-nums">
              {profile.profile.itemCount} esercizi · {profile.profile.durationMin} min ·{' '}
              {profile.profile.totalPoints} pt
            </p>
            <p>
              {Object.entries(profile.profile.kindDistribution)
                .filter(([, v]) => (v ?? 0) > 0)
                .map(
                  ([k, v]) =>
                    `${Math.round((v ?? 0) * 100)}% ${KIND_LABELS[k as keyof typeof KIND_LABELS]}`,
                )
                .join(' · ')}
            </p>
            {profile.profile.recurringTopics.length > 0 && (
              <p className="text-fg-muted">
                Ricorrenti: {profile.profile.recurringTopics.join(', ')}
              </p>
            )}
            {profile.edited && <p className="text-[11px] text-info">Modificato a mano</p>}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-fg-muted underline hover:text-fg-secondary"
            >
              Modifica profilo
            </button>
          </div>
        )}
        {profile && editing && (
          <ProfileEditor slug={subjectSlug} profile={profile} onDone={() => setEditing(false)} />
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => extract.mutate()}
            disabled={extract.isPending}
            className="rounded-[var(--radius-control)] border border-border px-2.5 py-1 text-xs text-fg-secondary hover:text-fg-primary"
          >
            {profile ? 'Ri-estrai profilo' : 'Estrai profilo'}
          </button>
          <button
            type="button"
            onClick={() => generate.mutate({ mode: 'esame_completo' })}
            disabled={!profile || generate.isPending}
            className="rounded-[var(--radius-control)] bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Simula esame
          </button>
        </div>

        <div className="flex gap-1.5">
          <select
            value={drillTopic}
            onChange={(e) => setDrillTopic(e.target.value)}
            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary"
            aria-label="Argomento del drill"
          >
            <option value="">Drill su argomento…</option>
            {(topicsQuery.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => generate.mutate({ mode: 'drill_argomento', topicId: drillTopic })}
            disabled={!drillTopic || generate.isPending}
            className="rounded-[var(--radius-control)] border border-border px-2.5 py-1 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
          >
            Drill
          </button>
        </div>

        {(extract.isSuccess || generate.isSuccess) && !error && (
          <p className="text-[11px] text-ok">Job avviato — la lista si aggiorna a breve.</p>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {(error as Error).message}
          </p>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-2">
        {simsQuery.isSuccess && simsQuery.data.length === 0 && (
          <p className="px-1 text-xs text-fg-muted">Nessuna simulazione ancora.</p>
        )}
        {simsQuery.isError && (
          <p role="alert" className="px-1 text-xs text-danger">
            {(simsQuery.error as Error).message}
          </p>
        )}
        <ul className="space-y-1">
          {(simsQuery.data ?? []).map((sim) => (
            <li
              key={sim.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1 hover:bg-bg-raised"
            >
              <Link
                href={`/materie/${subjectSlug}/simulations/${sim.id}`}
                className="min-w-0 truncate text-sm text-fg-primary underline-offset-2 hover:underline"
              >
                {sim.title}
              </Link>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-muted">
                {sim.lastScoreRatio === null
                  ? `${sim.timeBudgetMin} min`
                  : `${Math.round(sim.lastScoreRatio * 100)}% · ${sim.attemptCount}×`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
