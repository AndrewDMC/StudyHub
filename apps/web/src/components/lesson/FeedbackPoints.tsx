'use client';

import type { ExplanationFeedbackDto, SessionItemCitationDto } from '@studyhub/contracts';
import { Markdown } from '@/components/SessionBriefing';
import { cn } from '@/lib/utils';

type Point = ExplanationFeedbackDto['correct'][number];

const ROWS = [
  {
    key: 'correct',
    label: 'Giusto',
    icon: '✓',
    empty: 'Per ora niente in comune con il materiale: riprova con più dettagli.',
    tone: 'border-ok/30 bg-ok/5',
    text: 'text-ok',
  },
  {
    key: 'missing',
    label: 'Manca',
    icon: '+',
    empty: 'Non manca niente di importante.',
    tone: 'border-warn/30 bg-warn/5',
    text: 'text-warn',
  },
  {
    key: 'wrong',
    label: 'Attento',
    icon: '!',
    empty: 'Nessun errore trovato.',
    tone: 'border-danger/30 bg-danger/5',
    text: 'text-danger',
  },
] as const;

/** Giusto · Manca · Attento: always the three rows, each point with the passage it comes from. */
export function FeedbackPoints({
  feedback,
  onOpenCitation,
}: {
  feedback: Pick<ExplanationFeedbackDto, 'correct' | 'missing' | 'wrong'>;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
}) {
  return (
    <div className="space-y-2">
      {ROWS.map((row) => {
        const points: Point[] = feedback[row.key];
        const id = `feedback-${row.key}`;
        return (
          <section
            key={row.key}
            aria-labelledby={id}
            className={cn(
              'flex gap-3 rounded-[var(--radius-control)] border p-3 max-md:flex-col',
              row.tone,
            )}
          >
            <h3
              id={id}
              className={cn('flex w-16 shrink-0 items-start gap-1 text-sm font-semibold', row.text)}
            >
              <span aria-hidden="true">{row.icon}</span>
              {row.label}
            </h3>
            {points.length === 0 ? (
              <p className="text-sm text-fg-secondary">{row.empty}</p>
            ) : (
              <ul className="min-w-0 flex-1 space-y-2">
                {points.map((point, i) => (
                  <li key={i} className="space-y-1">
                    <div className="text-fg-secondary">
                      <Markdown source={point.text} />
                    </div>
                    {point.citation ? (
                      <button
                        type="button"
                        onClick={() => onOpenCitation(point.citation!)}
                        title={`«${point.citation.quote}»`}
                        className="min-h-11 rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-accent/25 md:min-h-7"
                      >
                        ↗ {point.citation.documentName} · p. {point.citation.page}
                      </button>
                    ) : (
                      <span className="text-xs text-fg-muted">Senza fonte</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
