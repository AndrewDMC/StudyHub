'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TopicDto } from '@studyhub/contracts';

async function fetchTopics(slug: string): Promise<TopicDto[]> {
  const res = await fetch(`/api/subjects/${slug}/topics`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli argomenti');
  return body.topics as TopicDto[];
}

function buildTree(topics: TopicDto[]): Map<string | null, TopicDto[]> {
  const byParent = new Map<string | null, TopicDto[]>();
  for (const topic of topics) {
    const key = topic.parentId;
    const list = byParent.get(key) ?? [];
    list.push(topic);
    byParent.set(key, list);
  }
  return byParent;
}

// docs/02-filesystem-e-dati.md §5 — "niente numeri magici": la formula è
// sempre visibile nel tooltip, non solo il numero finale.
const MASTERY_FORMULA =
  '0.5·retrievability media card + 0.3·accuratezza simulazioni + 0.2·copertura materiale letto (pesi rinormalizzati sulle componenti con dati)';

function masteryColorClass(mastery: number | null): string {
  if (mastery === null) return 'bg-fg-muted/30';
  if (mastery < 0.4) return 'bg-danger';
  if (mastery < 0.7) return 'bg-warn';
  return 'bg-ok';
}

function MasteryDot({ mastery }: { mastery: number | null }) {
  const title =
    mastery === null
      ? `Nessun dato ancora (né card ripassate né simulazioni su questo argomento). Formula: ${MASTERY_FORMULA}`
      : `Mastery ${Math.round(mastery * 100)}%. Formula: ${MASTERY_FORMULA}`;
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${masteryColorClass(mastery)}`}
    />
  );
}

function TopicNode({
  topic,
  byParent,
  depth,
  onDelete,
}: {
  topic: TopicDto;
  byParent: Map<string | null, TopicDto[]>;
  depth: number;
  onDelete: (id: string) => void;
}) {
  const children = byParent.get(topic.id) ?? [];
  return (
    <li>
      <div
        className="group flex items-center justify-between rounded-[var(--radius-control)] px-2 py-1 hover:bg-bg-raised"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg-primary">
          <MasteryDot mastery={topic.mastery} />
          <span className="truncate">{topic.name}</span>
        </span>
        <button
          type="button"
          onClick={() => onDelete(topic.id)}
          className="hidden text-xs text-fg-muted hover:text-danger group-hover:inline"
          aria-label={`Elimina ${topic.name}`}
        >
          Elimina
        </button>
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TopicNode
              key={child.id}
              topic={child}
              byParent={byParent}
              depth={depth + 1}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TopicsPanel({ subjectSlug }: { subjectSlug: string }) {
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['topics', subjectSlug],
    queryFn: () => fetchTopics(subjectSlug),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['topics', subjectSlug] });

  const createMutation = useMutation({
    mutationFn: async (topicName: string) => {
      const res = await fetch(`/api/subjects/${subjectSlug}/topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: topicName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Creazione fallita');
      return body.topic as TopicDto;
    },
    onSuccess: () => {
      setName('');
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/subjects/${subjectSlug}/topics/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Eliminazione fallita');
      }
    },
    onSuccess: invalidate,
  });

  const roots = query.data ? (buildTree(query.data).get(null) ?? []) : [];
  const byParent = query.data ? buildTree(query.data) : new Map();

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Argomenti
      </h2>

      {query.isLoading && <p className="px-1 text-xs text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="px-1 text-xs text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && roots.length === 0 && (
        <p className="px-1 text-xs text-fg-muted">Nessun argomento ancora.</p>
      )}
      {query.isSuccess && roots.length > 0 && (
        <ul>
          {roots.map((topic) => (
            <TopicNode
              key={topic.id}
              topic={topic}
              byParent={byParent}
              depth={0}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))}
        </ul>
      )}

      <form
        className="mt-2 flex gap-1.5 px-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) createMutation.mutate(name.trim());
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nuovo argomento"
          className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-xs text-fg-secondary hover:text-fg-primary"
        >
          +
        </button>
      </form>
    </div>
  );
}
