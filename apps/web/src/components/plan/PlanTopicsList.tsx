import type { PlanDto } from '@studyhub/contracts';
import { CARD_BOX } from '@/components/subject-tabs/styles';
import { planTopicOrder, whenLabel } from './planModel';
import { MethodBadge } from './MethodBadge';

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
    <section aria-labelledby="fuori" data-testid="plan-topics" className="space-y-3">
      <h2 id="fuori" className="text-base font-semibold text-fg-primary">
        Argomenti{' '}
        <span className="text-sm font-normal text-fg-secondary">· in ordine di studio</span>
      </h2>
      <ol className={`${CARD_BOX} divide-y divide-border`}>
        {entries.map((e, i) => {
          const out = e.method === 'fuori';
          const meta = out
            ? 'Fuori dal piano'
            : e.done === e.total
              ? `${e.total === 1 ? '1 lezione' : `${e.total} lezioni`} · ${e.total === 1 ? 'fatta' : 'fatte'}`
              : e.done > 0
                ? `${e.done} di ${e.total} fatte`
                : e.total === 1
                  ? '1 lezione'
                  : `${e.total} lezioni`;
          return (
            <li key={e.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className="w-5 font-mono text-xs text-fg-secondary">{i + 1}.</span>
              <div className="min-w-0 flex-1 basis-56">
                <p className={`font-medium ${out ? 'text-fg-secondary' : 'text-fg-primary'}`}>
                  {e.name}
                </p>
                <p className="text-xs text-fg-secondary">
                  {meta}
                  {e.userSprint ? ' · sprint scelto da te' : ''}
                </p>
              </div>
              {out ? (
                <span className="inline-flex h-6 items-center rounded-[var(--radius-control)] bg-danger/10 px-2 text-xs font-medium text-danger">
                  Fuori
                </span>
              ) : e.method === 'misto' ? (
                <span className="inline-flex h-6 items-center rounded-[var(--radius-control)] bg-bg-raised px-2 text-xs font-medium text-fg-secondary">
                  Misto
                </span>
              ) : (
                <MethodBadge method={e.method === 'sprint' ? 'sprint' : 'standard'} />
              )}
              <span className="w-32 text-right text-[13px] text-fg-secondary">
                {out ? '—' : whenLabel(e.openDates, today)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
