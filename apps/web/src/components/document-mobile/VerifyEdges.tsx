import { ArrowRight } from 'lucide-react';
import type { SchemaGraphDto } from '@studyhub/contracts';

/** "Archi": relations between nodes, labels resolved from the node list. */
export function VerifyEdges({ graph }: { graph: SchemaGraphDto }) {
  if (graph.edges.length === 0) return null;
  const labelOf = (key: string) => graph.nodes.find((n) => n.nodeKey === key)?.label ?? key;
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">Archi</h2>
      <ul className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg-surface">
        {graph.edges.map((e, i) => (
          <li
            key={e.id}
            className={`flex min-h-12 items-center gap-2 px-3.5 py-2 text-sm ${
              i > 0 ? 'border-t border-border' : ''
            }`}
          >
            <span className="min-w-0 flex-1 break-words">
              {labelOf(e.from)}
              <ArrowRight className="mx-1.5 inline h-4 w-4 text-fg-muted" aria-hidden="true" />
              <span className="sr-only"> verso </span>
              {labelOf(e.to)}
            </span>
            <span className="max-w-[40%] shrink-0 break-words text-right text-xs text-fg-muted">
              {e.label ?? e.type}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
