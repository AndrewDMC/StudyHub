'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DocumentDto,
  EstimateGenerationCostResponse,
  ExamProfileDto,
  SimulationSummaryDto,
  TopicDto,
  TopicTrendDto,
} from '@studyhub/contracts';
import { PASS_RATIO } from '@studyhub/core/browser';
import { formatRecurringTopic } from '@/lib/format';
import { ModelPicker, MODEL_OPTIONS } from './ModelPicker';
import { ProgressBar } from './subject-tabs/ProgressBar';
import { StatusBadge } from './subject-tabs/StatusBadge';
import { TabCard } from './subject-tabs/TabCard';
import { TabEmptyState } from './subject-tabs/TabEmptyState';
import { TabSection } from './subject-tabs/TabSection';
import { TabError, TabLoading } from './subject-tabs/TabState';
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD_BOX,
  DIVIDED,
  FOCUS,
  INPUT,
  SECTION_TITLE,
  TAB_STACK,
  TEXTAREA,
} from './subject-tabs/styles';

export async function getJson<T>(url: string, key: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Caricamento fallito');
  return body[key] as T;
}

export async function postJson(url: string, payload: unknown, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Operazione fallita');
  return body;
}

/** €0.0001 → "€0.0001"; €0 → "gratis" (FakeProvider, nessuna chiave configurata). */
export function formatCost(costEur: number): string {
  return costEur === 0 ? 'gratis' : `~€${costEur.toFixed(4)}`;
}

export type SimScope = { docIds: string[] } | { topicIds: string[] };

export async function fetchEstimate(
  slug: string,
  scope: SimScope,
  model: string,
): Promise<EstimateGenerationCostResponse> {
  const res = await fetch(`/api/subjects/${slug}/artifacts/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, model }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Stima costo fallita');
  return body as EstimateGenerationCostResponse;
}

/** A topic's score over successive graded attempts: a sparkline plus the last value and the change. */
export function TopicTrendRow({ trend }: { trend: TopicTrendDto }) {
  const W = 72;
  const H = 18;
  const n = trend.points.length;
  const coords = trend.points.map((p, i) => ({
    x: n === 1 ? W / 2 : (i / (n - 1)) * W,
    y: H - 1 - p.ratio * (H - 2),
  }));
  const last = trend.points[n - 1]!;
  const delta = trend.delta;
  const detail = trend.points
    .map((p) => `${p.simulationTitle}: ${Math.round(p.ratio * 100)}%`)
    .join(' → ');
  return (
    <li className="flex items-center gap-2" title={detail}>
      <span className="min-w-0 flex-1 truncate text-fg-secondary">{trend.name}</span>
      <svg width={W} height={H} role="img" aria-label={`Andamento ${trend.name}`}>
        {n > 1 && (
          <polyline
            points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="text-accent"
          />
        )}
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={2} className="fill-accent" />
        ))}
      </svg>
      <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-fg-muted">
        {Math.round(last.ratio * 100)}%
        {delta !== null && (
          <span className={delta >= 0 ? 'text-ok' : 'text-danger'}>
            {' '}
            {delta >= 0 ? '+' : '−'}
            {Math.round(Math.abs(delta) * 100)}
          </span>
        )}
      </span>
    </li>
  );
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
    <label className="flex items-center justify-between gap-3 text-[13px] text-fg-secondary">
      {label}
      <input
        type="number"
        min={1}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
        className={`${INPUT} w-24 text-right font-mono`}
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      {num('itemCount', 'Esercizi')}
      {num('durationMin', 'Durata (min)')}
      {num('totalPoints', 'Punti totali')}
      {num('avgMinutesPerItem', 'Min per esercizio')}
      <label className="flex flex-col gap-1.5 text-[13px] text-fg-secondary">
        Note
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          rows={2}
          className={`${TEXTAREA} text-[13px]`}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className={BTN_PRIMARY}
        >
          Salva
        </button>
        <button type="button" onClick={onDone} className={BTN_GHOST}>
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

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

/** Vertical bars of the last graded simulations, with the pass line. */
function ScoreChart({ sims }: { sims: SimulationSummaryDto[] }) {
  const graded = sims
    .filter((s) => s.lastScoreRatio !== null)
    .sort((a, b) => (a.lastGradedAt ?? '').localeCompare(b.lastGradedAt ?? ''))
    .slice(-6);
  if (graded.length === 0)
    return <p className="text-sm text-fg-secondary">Nessuna simulazione corretta ancora.</p>;
  const summary = graded.map((s) => `${Math.round(s.lastScoreRatio! * 100)}%`).join(', ');
  const passPct = Math.round(PASS_RATIO * 100);
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={`Voti: ${summary}`} className="relative">
        <div className="flex h-[120px] items-end gap-3">
          {graded.map((s) => {
            const ratio = s.lastScoreRatio!;
            return (
              <div key={s.id} className="flex min-w-0 flex-1 flex-col items-center justify-end">
                <span className="font-mono text-xs tabular-nums text-fg-primary">
                  {Math.round(ratio * 100)}%
                </span>
                <span
                  className={`mt-1 w-full rounded ${ratio >= PASS_RATIO ? 'bg-ok' : 'bg-warn'}`}
                  style={{ height: `${Math.max(2, ratio * 80)}px` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-3">
          {graded.map((s) => (
            <span key={s.id} className="flex-1 text-center text-xs text-fg-secondary">
              {s.lastGradedAt ? shortDate(s.lastGradedAt) : '—'}
            </span>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border-strong"
          style={{ bottom: `${(passPct / 100) * 80 + 20}px` }}
        />
      </div>
      <p className="text-xs text-fg-secondary">Sufficienza {passPct}%</p>
    </div>
  );
}

/** Exams & simulations (docs/fasi/F5-esami-simulazioni.md) on the subject page. */
export function ExamPrepPanel({
  subjectSlug,
  documents,
}: {
  subjectSlug: string;
  documents: DocumentDto[];
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [drillTopic, setDrillTopic] = useState('');
  const [useImages, setUseImages] = useState(false);
  const [model, setModel] = useState<string>(MODEL_OPTIONS[2].id); // opus: default routing per generate_simulation (docs/03 §4)

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

  const trendsQuery = useQuery({
    queryKey: ['topic-trends', subjectSlug],
    queryFn: () => getJson<TopicTrendDto[]>(`/api/subjects/${subjectSlug}/topic-trends`, 'trends'),
  });

  const refreshSoon = (key: string) =>
    setTimeout(() => queryClient.invalidateQueries({ queryKey: [key, subjectSlug] }), 3000);

  const extract = useMutation({
    // extract_exam_profile has no pre-flight estimate/model choice in this slice — the picker
    // below applies to Simula esame/Drill (generate_simulation) only.
    mutationFn: () => postJson(`/api/subjects/${subjectSlug}/exam-profile`, { useImages }),
    onSuccess: () => refreshSoon('exam-profile'),
  });
  const generate = useMutation({
    mutationFn: (payload: { mode: 'esame_completo' | 'drill_argomento'; topicId?: string }) =>
      postJson(`/api/subjects/${subjectSlug}/simulations`, { ...payload, model }),
    onSuccess: () => refreshSoon('simulations'),
  });

  const profile = profileQuery.data;
  const error = extract.error ?? generate.error;

  // generate_simulation draws items only from study material, never the past exams the profile
  // itself came from (docs/fasi/F5) — the estimate scope mirrors that.
  const studyDocIds = documents
    .filter((d) => d.status === 'parsed' && d.type !== 'esami')
    .map((d) => d.id);
  const examScope: SimScope | null = drillTopic
    ? { topicIds: [drillTopic] }
    : studyDocIds.length > 0
      ? { docIds: studyDocIds }
      : null;
  const estimateQuery = useQuery({
    queryKey: [
      'generation-estimate',
      subjectSlug,
      model,
      drillTopic ? `t:${drillTopic}` : `d:${studyDocIds.join(',')}`,
    ],
    queryFn: () => fetchEstimate(subjectSlug, examScope!, model),
    enabled: examScope !== null,
  });
  const costLabel = estimateQuery.data
    ? formatCost(estimateQuery.data.perKind.simulation!.costEur)
    : null;

  const sims = simsQuery.data ?? [];
  const topicName = (id: string | null) =>
    id ? (topicsQuery.data ?? []).find((t) => t.id === id)?.name : undefined;

  return (
    <div className={TAB_STACK}>
      <div className="grid grid-cols-1 gap-5 @2xl/tab:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <TabCard label="Simulazioni d'esame" labelId="sim-card-title">
          {profileQuery.isLoading && <TabLoading rows={2} />}
          {profileQuery.isError && (
            <TabError
              message={(profileQuery.error as Error).message}
              onRetry={() => profileQuery.refetch()}
            />
          )}
          {profileQuery.isSuccess && !profile && (
            <p className="text-sm text-fg-secondary">
              Nessun profilo d&apos;esame. Carica gli esami passati come tipo &quot;Esami&quot;, poi
              estrai il profilo.
            </p>
          )}
          {profile && !editing && (
            <div className="flex flex-col gap-2">
              <p className="font-mono text-2xl font-semibold tracking-[-0.02em] tabular-nums text-fg-primary">
                {profile.profile.itemCount} esercizi · {profile.profile.durationMin} min ·{' '}
                {profile.profile.totalPoints} pt
              </p>
              <p className="text-sm text-fg-secondary">
                {Object.entries(profile.profile.kindDistribution)
                  .filter(([, v]) => (v ?? 0) > 0)
                  .map(
                    ([k, v]) =>
                      `${Math.round((v ?? 0) * 100)}% ${KIND_LABELS[k as keyof typeof KIND_LABELS]}`,
                  )
                  .join(' · ')}
              </p>
              {profile.profile.recurringTopics.length > 0 && (
                <p className="text-sm text-fg-secondary">
                  Ricorrenti: {profile.profile.recurringTopics.map(formatRecurringTopic).join(', ')}
                </p>
              )}
              {profile.edited && (
                <div>
                  <StatusBadge tone="info">Modificato a mano</StatusBadge>
                </div>
              )}
              <div>
                <button type="button" onClick={() => setEditing(true)} className={BTN_GHOST}>
                  Modifica profilo
                </button>
              </div>
            </div>
          )}
          {profile && editing && (
            <ProfileEditor slug={subjectSlug} profile={profile} onDone={() => setEditing(false)} />
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => extract.mutate()}
              disabled={extract.isPending}
              className={BTN_SECONDARY}
            >
              {profile ? 'Ri-estrai profilo' : 'Estrai profilo'}
            </button>
            <button
              type="button"
              onClick={() => generate.mutate({ mode: 'esame_completo' })}
              disabled={!profile || generate.isPending}
              className={`${BTN_PRIMARY} h-11`}
            >
              Simula esame{!drillTopic && costLabel && ` · ${costLabel}`}
            </button>
          </div>

          <div className="grid gap-3 border-t border-border pt-4 @lg/tab:grid-cols-2">
            <ModelPicker
              value={model}
              onChange={setModel}
              disabled={generate.isPending}
              defaultId={MODEL_OPTIONS[2].id}
            />
            <div className="flex gap-2">
              <select
                value={drillTopic}
                onChange={(e) => setDrillTopic(e.target.value)}
                className={`${INPUT} min-w-0 flex-1 text-[13px]`}
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
                className={BTN_SECONDARY}
              >
                Drill{drillTopic && costLabel && ` · ${costLabel}`}
              </button>
            </div>
            <label className="col-span-full flex items-start gap-2 text-[13px] text-fg-secondary">
              <input
                type="checkbox"
                checked={useImages}
                onChange={(e) => setUseImages(e.target.checked)}
                className={`mt-0.5 ${FOCUS}`}
              />
              Usa anche le pagine degli esami come immagini (figure e grafici; costa di più)
            </label>
          </div>

          {(extract.isSuccess || generate.isSuccess) && !error && (
            <p role="status" className="text-xs text-ok">
              Job avviato — la lista si aggiorna a breve.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {(error as Error).message}
            </p>
          )}
        </TabCard>

        <TabCard label="Andamento" aria-label="Voti delle simulazioni">
          <ScoreChart sims={sims} />
        </TabCard>
      </div>

      <TabSection title="Simulazioni" {...(simsQuery.isSuccess ? { count: sims.length } : {})}>
        {simsQuery.isLoading && <TabLoading rows={3} />}
        {simsQuery.isError && (
          <TabError
            message={(simsQuery.error as Error).message}
            onRetry={() => simsQuery.refetch()}
          />
        )}
        {simsQuery.isSuccess && sims.length === 0 && (
          <TabEmptyState
            title="Nessuna simulazione ancora."
            text="Estrai il profilo e genera la prima simulazione."
          />
        )}
        {sims.length > 0 && (
          <ul className={`${CARD_BOX} ${DIVIDED}`}>
            {sims.map((sim) => {
              const simHref = `/materie/${subjectSlug}/simulations/${sim.id}`;
              const name = topicName(sim.topicId);
              const kind =
                sim.mode === 'drill_argomento'
                  ? name
                    ? `Drill: ${name}`
                    : 'Drill'
                  : 'Esame completo';
              return (
                <li
                  key={sim.id}
                  className="flex flex-col gap-3 px-5 py-3.5 @3xl/tab:grid @3xl/tab:grid-cols-[minmax(0,1.6fr)_minmax(140px,1fr)_auto] @3xl/tab:items-center @3xl/tab:gap-4"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={simHref}
                      className={`truncate text-sm font-medium text-fg-primary hover:underline ${FOCUS}`}
                    >
                      {sim.title}
                    </Link>
                    <span className="truncate text-xs text-fg-secondary">
                      {kind} · {sim.itemCount} esercizi · {sim.timeBudgetMin} min
                    </span>
                  </div>
                  {sim.lastScoreRatio === null ? (
                    <span className="font-mono text-xs tabular-nums text-fg-secondary">
                      {sim.timeBudgetMin} min
                    </span>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <ProgressBar
                        ratio={sim.lastScoreRatio}
                        tone={sim.lastScoreRatio >= PASS_RATIO ? 'ok' : 'warn'}
                      />
                      <span className="font-mono text-xs tabular-nums text-fg-secondary">
                        {Math.round(sim.lastScoreRatio * 100)}% · {sim.attemptCount}×
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {sim.openAttemptId ? (
                      <Link href={simHref} className={`${BTN_SECONDARY} h-9`}>
                        Riprendi
                      </Link>
                    ) : sim.lastAttemptId ? null : (
                      <Link href={simHref} className={`${BTN_SECONDARY} h-9`}>
                        Inizia
                      </Link>
                    )}
                    {sim.lastAttemptId && (
                      <Link
                        href={`/materie/${subjectSlug}/attempts/${sim.lastAttemptId}/results`}
                        className={BTN_GHOST}
                      >
                        Vedi la correzione
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </TabSection>

      {trendsQuery.isSuccess && trendsQuery.data.length > 0 && (
        <TabCard>
          <section aria-label="Andamento per argomento" className="flex flex-col gap-3">
            <h3 className={SECTION_TITLE}>Andamento per argomento</h3>
            <ul className="flex flex-col gap-2 text-xs">
              {trendsQuery.data.map((t) => (
                <TopicTrendRow key={t.topicId} trend={t} />
              ))}
            </ul>
          </section>
        </TabCard>
      )}
    </div>
  );
}
