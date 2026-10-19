import Link from 'next/link';
import type { FlashcardStatsDto } from '@studyhub/contracts';
import { flashcardsLink } from '@/lib/flashcardsView';
import { LINK_TEXT, SECTION_TITLE } from '../shared/styles';

function dayDate(date: string): Date {
  return new Date(`${date.slice(0, 10)}T12:00:00`);
}

/** Next 7 days as bars: counts in text, bars hidden; one `img` with the full description. */
export function MiniForecast({
  slug,
  forecast,
}: {
  slug: string;
  forecast: FlashcardStatsDto['forecast'] | undefined;
}) {
  const days = (forecast ?? []).slice(0, 7);
  const max = Math.max(1, ...days.map((d) => d.count));
  const label = days
    .map((d, i) =>
      i === 0
        ? `oggi ${d.count}`
        : `${dayDate(d.date).toLocaleDateString('it-IT', { weekday: 'long' })} ${d.count}`,
    )
    .join(', ');
  return (
    <div className="flex flex-col gap-3">
      <h3 className={SECTION_TITLE}>Prossimi 7 giorni</h3>
      {forecast ? (
        <div
          role="img"
          aria-label={`Card in scadenza: ${label}`}
          className="grid h-36 grid-cols-7 items-end gap-2"
        >
          {days.map((d, i) => (
            <div
              key={d.date}
              aria-hidden="true"
              className="flex h-full flex-col items-center justify-end gap-1.5"
            >
              <span className="font-mono text-xs text-fg-secondary">{d.count}</span>
              <span
                className={`w-full rounded ${i === 0 ? 'bg-accent' : 'bg-border-strong'}`}
                style={{ height: `max(4px, ${(d.count / max) * 96}px)` }}
              />
              <span
                className={`text-xs ${i === 0 ? 'font-medium text-fg-primary' : 'text-fg-secondary'}`}
              >
                {i === 0
                  ? 'Oggi'
                  : dayDate(d.date)
                      .toLocaleDateString('it-IT', { weekday: 'short' })
                      .replace('.', '')}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="h-36 animate-pulse rounded bg-bg-raised motion-reduce:animate-none"
        />
      )}
      <Link
        href={flashcardsLink(slug, { view: 'statistiche' })}
        scroll={false}
        className={LINK_TEXT}
      >
        Tutte le statistiche →
      </Link>
    </div>
  );
}
