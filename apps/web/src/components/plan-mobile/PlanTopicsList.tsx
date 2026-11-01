import type { PlanDto } from '@studyhub/contracts';
import { planTopicOrder, topicMetaLabel, whenLabel } from '../plan/planModel';
import { MethodBadge } from '../plan/MethodBadge';
import { cardClass } from '../simulation-mobile/styles';

/** Topics in study order (read-only: manual reordering has no API yet). */
export function PlanTopicsList({
  plan,
  today,
  nameOf,
}: {
  plan: PlanDto;
  today: string;
  nameOf: (key: string) => string;
}) {
  const entries = planTopicOrder(plan, nameOf);
  if (entries.length === 0) return null;
  return (
    <section
      aria-labelledby="mp-ord"
      data-testid="plan-topics"
      className="flex min-w-0 flex-col gap-2"
    >
      <h2 id="mp-ord" className="text-base font-semibold text-fg-primary">
        Argomenti{' '}
        <span className="text-sm font-normal text-fg-secondary">· in ordine di studio</span>
      </h2>
      <ol className={`${cardClass} divide-y divide-border`}>
        {entries.map((e, i) => {
          const out = e.method === 'fuori';
          return (
            <li
              key={e.key}
              className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
            >
              <span className="w-5 shrink-0 font-mono text-xs text-fg-secondary">{i + 1}.</span>
              <div className="min-w-0 flex-1 basis-40">
                <p
                  className={`text-sm font-medium ${out ? 'text-fg-secondary' : 'text-fg-primary'}`}
                >
                  {e.name}
                </p>
                <p className="text-xs text-fg-secondary">{topicMetaLabel(e)}</p>
              </div>
              <div className="flex items-center gap-2">
                {out ? (
                  <span className="inline-flex h-6 items-center rounded-[var(--radius-control)] bg-danger/10 px-2 text-xs font-medium text-danger">
                    Fuori
                  </span>
                ) : e.method === 'misto' ? (
                  <span className="inline-flex h-6 items-center rounded-[var(--radius-control)] bg-bg-raised px-2 text-xs font-medium text-fg-secondary">
                    Misto
                  </span>
                ) : (
                  <MethodBadge method={e.method === 'sprint' ? 'sprint' : 'standard'} size="sm" />
                )}
                <span className="text-xs text-fg-secondary">
                  {out ? '—' : whenLabel(e.openDates, today)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
