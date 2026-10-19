'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { FlashcardStatsDto } from '@studyhub/contracts';
import { flashcardsLink } from '@/lib/flashcardsView';
import {
  forecastPeak,
  retentionMessage,
  retentionSummary,
  STAT_TILES,
} from '@/lib/flashcardMobile';
import { useFlashcardStats } from '../api';
import { BlockError, SkeletonBlock } from '../shared/Skeletons';
import { PlainStateDot } from '../shared/StateDot';
import { CARD_BOX, FOCUS } from '../shared/styles';
import { CalibrationCard } from './CalibrationCard';
import { MasteryList } from './MasteryList';

const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

function RiskBanner({ risk }: { risk: NonNullable<FlashcardStatsDto['atRiskForNextExam']> }) {
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-warn/35 bg-warn/10 px-5 py-3.5 text-sm"
    >
      <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden="true" />
      <strong className="font-semibold">
        {risk.atRiskCount} card a rischio per l&apos;esame del {dayMonth(risk.examDate)}.
      </strong>
      <span className="text-fg-secondary">
        Con il ritmo attuale non le avrai consolidate in tempo.
      </span>
    </div>
  );
}

function StateTiles({
  slug,
  stats,
  mobile,
}: {
  slug: string;
  stats: FlashcardStatsDto;
  mobile: boolean;
}) {
  const tile = `${CARD_BOX} flex min-h-14 flex-col gap-1 p-4`;
  return (
    <section
      aria-label="Card per stato"
      className={`grid grid-cols-2 gap-3 ${mobile ? '' : '@3xl/fc:grid-cols-5'}`}
    >
      {STAT_TILES.map((t) => (
        <div key={t.state} className={tile}>
          <PlainStateDot state={t.state} />
          <span className="text-2xl font-semibold tabular-nums">
            {stats.countsByState[t.state] ?? 0}
          </span>
        </div>
      ))}
      <Link
        href={flashcardsLink(slug, { view: 'card', escluse: true })}
        scroll={false}
        className={`${tile} min-h-14 border-dashed border-border-strong ${FOCUS} ${mobile ? 'col-span-2' : ''}`}
      >
        <span className="text-[13px]">Escluse dal ripasso</span>
        <span className="text-2xl font-semibold tabular-nums">{stats.excludedCount}</span>
      </Link>
    </section>
  );
}

function ForecastCard({ stats }: { stats: FlashcardStatsDto }) {
  const f = stats.forecast;
  const { max } = forecastPeak(f);
  const avg = f.length ? Math.round(f.reduce((s, d) => s + d.count, 0) / f.length) : 0;
  const examIdx = stats.atRiskForNextExam
    ? f.findIndex((d) => d.date.slice(0, 10) === stats.atRiskForNextExam!.examDate.slice(0, 10))
    : -1;
  return (
    <section aria-labelledby="fc-prev" className={`${CARD_BOX} flex flex-col gap-3 p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="fc-prev" className="text-[15px] font-semibold">
          Prossimi 30 giorni
        </h2>
        <span className="text-[13px] text-fg-secondary">
          media {avg} al giorno · picco {max}
        </span>
      </div>
      {max === 0 ? (
        <p className="text-sm text-fg-secondary">
          Nessun ripasso in programma nei prossimi 30 giorni.
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Card in scadenza nei prossimi 30 giorni, da ${f[0]?.count ?? 0} oggi a ${f[f.length - 1]?.count ?? 0} tra trenta giorni, picco ${max}`}
            className="flex h-[120px] items-end gap-[2px] border-b border-border @3xl/fc:gap-[3px]"
          >
            {f.map((d, i) => (
              <div
                key={d.date}
                aria-hidden="true"
                className={`flex-1 rounded-t-sm ${i === 0 ? 'bg-accent' : i === examIdx ? 'bg-warn' : 'bg-border-strong'}`}
                style={{ height: `max(2px, ${(d.count / max) * 100}%)` }}
              />
            ))}
          </div>
          <div
            aria-hidden="true"
            className="relative flex justify-between text-xs text-fg-secondary"
          >
            <span>oggi</span>
            <span>+15 g</span>
            <span>+30 g</span>
            {examIdx > 0 && (
              <span
                className="absolute top-0 -translate-x-1/2 text-warn"
                style={{ left: `${(examIdx / Math.max(1, f.length - 1)) * 100}%` }}
              >
                esame
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function RetentionCard({ stats }: { stats: FlashcardStatsDto }) {
  const r = stats.retention;
  const summary = retentionSummary(r.buckets);
  const below = summary ? summary.actual < summary.predicted - 0.05 : false;
  const p = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <section aria-labelledby="fc-ritenz" className={`${CARD_BOX} flex flex-col gap-3 p-5`}>
      <h2 id="fc-ritenz" className="text-[15px] font-semibold">
        Quanto ricordi
      </h2>
      {summary ? (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <div className="flex flex-col-reverse rounded-[var(--radius-control)] bg-bg-inset p-3">
              <dt className="text-[13px] text-fg-secondary">Previsto</dt>
              <dd className="text-2xl font-semibold tabular-nums">{p(summary.predicted)}</dd>
            </div>
            <div className="flex flex-col-reverse rounded-[var(--radius-control)] bg-bg-inset p-3">
              <dt className="text-[13px] text-fg-secondary">Reale</dt>
              <dd className={`text-2xl font-semibold tabular-nums ${below ? 'text-warn' : ''}`}>
                {p(summary.actual)}
              </dd>
            </div>
          </dl>
          <p className="text-[13px] text-fg-secondary">
            {retentionMessage(summary.actual, summary.predicted)}
            {r.sampleCount < 50 && ` Su ${r.sampleCount} ripassi il dato è ancora indicativo.`}
          </p>
        </>
      ) : (
        <p className="text-[13px] text-fg-secondary">
          Servono ripassi ripetuti sulle stesse card per calcolarla.
        </p>
      )}
    </section>
  );
}

/** Statistiche: exam risk, cards per state, outlook, retention, mastery and calibration. */
export function StatsView({ slug, mobile = false }: { slug: string; mobile?: boolean }) {
  const query = useFlashcardStats(slug);
  if (query.isError) {
    return (
      <BlockError
        message="Impossibile caricare le statistiche."
        onRetry={() => void query.refetch()}
      />
    );
  }
  const stats = query.data;
  if (!stats) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonBlock key={i} className="h-16" />
          ))}
        </div>
        <SkeletonBlock className="h-48" />
        <SkeletonBlock className="h-48" />
      </div>
    );
  }
  const risk = stats.atRiskForNextExam;
  return (
    <div className={`flex flex-col gap-5 ${mobile ? 'p-0' : ''}`}>
      {risk && risk.atRiskCount > 0 && <RiskBanner risk={risk} />}
      <StateTiles slug={slug} stats={stats} mobile={mobile} />
      <div
        className={
          mobile
            ? 'flex flex-col gap-4'
            : 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4'
        }
      >
        <ForecastCard stats={stats} />
        <RetentionCard stats={stats} />
        <MasteryList slug={slug} topics={stats.topicMastery} />
        <CalibrationCard slug={slug} />
      </div>
    </div>
  );
}
