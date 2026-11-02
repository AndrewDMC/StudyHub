import Link from 'next/link';
import { StartTaskButton } from '../StartTaskButton';
import { TabEmptyState } from '../subject-tabs/TabEmptyState';
import { TabSection } from '../subject-tabs/TabSection';
import { ProgressBar } from '../subject-tabs/ProgressBar';
import { BTN_SECONDARY, CARD_BOX } from '../subject-tabs/styles';
import { masteryTone, type TopicPlanKind, type TopicRow } from './model';

const COLS =
  'grid grid-cols-[minmax(180px,2fr)_minmax(170px,1.6fr)_96px_minmax(140px,1.2fr)_112px] items-center gap-4 px-5';

const DOT: Record<TopicPlanKind, string> = {
  studied: 'bg-ok',
  in_progress: 'bg-accent',
  today: 'bg-accent',
  late: 'bg-warn',
  from: 'bg-border-strong',
  out: 'bg-danger',
  skipped: 'bg-border-strong',
  unplanned: 'bg-border-strong',
};

function methodText(method: TopicRow['method']): { text: string; cls: string } {
  if (method === 'sprint') return { text: 'Sprint', cls: 'text-info' };
  if (method === 'standard') return { text: 'Standard', cls: 'text-fg-secondary' };
  if (method === 'mixed') return { text: 'Misto', cls: 'text-fg-secondary' };
  return { text: '—', cls: 'text-fg-secondary' };
}

/** "Argomenti": one row per topic with plan state, method, mastery and the next action. */
export function TopicsTable({ slug, rows }: { slug: string; rows: TopicRow[] }) {
  if (rows.length === 0) {
    return (
      <div data-testid="overview-topics">
        <TabSection title="Argomenti">
          <TabEmptyState
            title="Nessun argomento"
            text="Carica del materiale e assegna gli argomenti: poi qui trovi lo stato di ciascuno."
            action={
              <Link href={`/materie/${slug}?tab=appunti`} className={BTN_SECONDARY}>
                Vai agli appunti
              </Link>
            }
          />
        </TabSection>
      </div>
    );
  }

  return (
    <div data-testid="overview-topics">
      <TabSection title="Argomenti" count={rows.length}>
        <div
          role="region"
          aria-label="Elenco degli argomenti"
          tabIndex={0}
          className={`${CARD_BOX} overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-accent`}
        >
          <div role="table" aria-label="Argomenti della materia" className="min-w-[760px]">
            <div
              role="row"
              className={`${COLS} border-b border-border py-2.5 text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary`}
            >
              <span role="columnheader">Argomento</span>
              <span role="columnheader">Nel piano</span>
              <span role="columnheader">Metodo</span>
              <span role="columnheader">Padronanza</span>
              <span role="columnheader">
                <span className="sr-only">Azione</span>
              </span>
            </div>
            {rows.map((row) => {
              const method = methodText(row.method);
              const pct = row.mastery === null ? null : Math.round(row.mastery * 100);
              return (
                <div
                  key={row.key}
                  role="row"
                  className={`${COLS} min-h-[60px] border-b border-border py-2.5 last:border-b-0`}
                >
                  <span role="cell" className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-fg-primary">{row.name}</span>
                    <span className="text-xs text-fg-secondary">{row.progress}</span>
                  </span>
                  <span
                    role="cell"
                    className="flex items-center gap-2 text-[13px] text-fg-secondary"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-2 shrink-0 rounded-full ${DOT[row.kind]}`}
                    />
                    {row.planLabel}
                  </span>
                  <span role="cell" className={`text-[13px] ${method.cls}`}>
                    {method.text}
                  </span>
                  <span role="cell" className="flex items-center gap-2">
                    {pct === null ? (
                      <span className="text-[13px] text-fg-secondary">—</span>
                    ) : (
                      <>
                        <ProgressBar
                          ratio={row.mastery!}
                          tone={masteryTone(row.mastery!)}
                          className="flex-1"
                        />
                        <span className="w-9 text-right font-mono text-xs text-fg-secondary">
                          {pct}%
                        </span>
                      </>
                    )}
                  </span>
                  <span role="cell">
                    {row.kind === 'studied' && row.topicId ? (
                      <Link
                        href={`/materie/${slug}/review?topicId=${row.topicId}`}
                        aria-label={`Ripassa: ${row.name}`}
                        className={`${BTN_SECONDARY} h-9 w-full`}
                      >
                        Ripassa
                      </Link>
                    ) : row.startable ? (
                      <span className="block [&>span]:w-full [&_button]:w-full">
                        <StartTaskButton
                          subjectSlug={slug}
                          taskId={row.startable.id}
                          kind={row.startable.kind}
                          label="Studia"
                          aria-label={`Studia: ${row.name}`}
                          className={`${BTN_SECONDARY} h-9 w-full`}
                        />
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </TabSection>
    </div>
  );
}
