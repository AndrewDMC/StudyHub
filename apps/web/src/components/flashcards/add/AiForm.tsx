'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { ModelPicker, MODEL_OPTIONS } from '../../ModelPicker';
import { enqueue, fetchEstimate, formatCost, type ScopeInput } from '../../GenerationPanel';
import { topicOptions } from '../cards/CardFilters';
import { useNotify } from '../Notifier';
import { BTN_GHOST, BTN_PRIMARY, INPUT, LABEL } from '../shared/styles';
import { FOOTER } from './ManualForm';

const COUNTS = [30, 60, 100] as const;

/** "Genera con l'AI": same job as the Genera panel, with the scope and the card count up front. */
export function AiForm({
  slug,
  documents,
  topics,
  onClose,
}: {
  slug: string;
  documents: DocumentDto[];
  topics: TopicDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const parsed = documents.filter((d) => d.status === 'parsed');
  const [scopeKind, setScopeKind] = useState<'all' | 'topics'>('all');
  const [topicIds, setTopicIds] = useState<Set<string>>(new Set());
  const [count, setCount] = useState<number>(60);
  const [model, setModel] = useState<string>(MODEL_OPTIONS[1].id);
  const [pickModel, setPickModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scope: ScopeInput =
    scopeKind === 'all' ? { docIds: parsed.map((d) => d.id) } : { topicIds: [...topicIds] };
  const empty = scopeKind === 'all' ? parsed.length === 0 : topicIds.size === 0;

  const estimate = useQuery({
    queryKey: ['generation-estimate', slug, model, count, JSON.stringify(scope)],
    queryFn: () => fetchEstimate(slug, scope, model, count),
    enabled: !empty,
  });

  if (parsed.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Nessun documento pronto.</p>
        <p className="text-[13px] text-fg-secondary">
          Carica un documento dalla colonna a sinistra per generare flashcard.
        </p>
        <div className={`${FOOTER} justify-end`}>
          <button type="button" disabled className={`${BTN_PRIMARY} max-md:h-12`}>
            Genera flashcard
          </button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await enqueue(slug, 'flashcards', scope, model, count);
      notify.success('Generazione avviata. Il mazzo arriverà in bozza.');
      // The job runs in the worker: refresh the lists once it had time to create the draft.
      setTimeout(() => {
        for (const key of ['artifacts', 'decks', 'stats']) {
          void qc.invalidateQueries({ queryKey: [key, slug] });
        }
      }, 3000);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Avvio generazione fallito.');
    } finally {
      setBusy(false);
    }
  };

  const radio =
    'flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-3 text-sm has-[:checked]:border-accent/40 has-[:checked]:bg-accent-subtle border-border max-md:min-h-12';

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty) void submit();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] text-fg-secondary">Da cosa partire</legend>
        <label className={radio}>
          <input
            data-autofocus
            type="radio"
            name="ai-scope"
            checked={scopeKind === 'all'}
            onChange={() => setScopeKind('all')}
            className="size-4 accent-[var(--accent)]"
          />
          Tutti i documenti pronti · {parsed.length}
        </label>
        <label className={radio}>
          <input
            type="radio"
            name="ai-scope"
            checked={scopeKind === 'topics'}
            onChange={() => setScopeKind('topics')}
            className="size-4 accent-[var(--accent)]"
          />
          Solo alcuni argomenti
        </label>
        {scopeKind === 'topics' && (
          <div className="flex max-h-48 flex-col overflow-auto rounded-[var(--radius-control)] border border-border p-1">
            {topicOptions(topics).map(({ topic, depth }) => (
              <label
                key={topic.id}
                className={`flex min-h-10 items-center gap-2.5 px-2 text-[13px] ${depth === 1 ? 'pl-6' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={topicIds.has(topic.id)}
                  onChange={(e) =>
                    setTopicIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(topic.id);
                      else next.delete(topic.id);
                      return next;
                    })
                  }
                  className="size-4 accent-[var(--accent)]"
                />
                {topic.name}
              </label>
            ))}
            {topics.length === 0 && (
              <p className="px-2 py-2 text-[13px] text-fg-secondary">
                Nessun argomento nella materia.
              </p>
            )}
          </div>
        )}
        {scopeKind === 'topics' && topicIds.size === 0 && (
          <p className="text-[13px] text-fg-secondary">Scegli almeno un argomento.</p>
        )}
      </fieldset>
      <label className={LABEL}>
        Quante card, circa
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={INPUT}>
          {COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p className="rounded-[var(--radius-control)] bg-bg-inset p-3 text-[13px] text-fg-secondary">
        Arrivano in un mazzo in bozza: le rivedi e lo approvi, solo allora entrano nel ripasso.
      </p>
      {pickModel && (
        <ModelPicker
          value={model}
          onChange={setModel}
          disabled={busy}
          defaultId={MODEL_OPTIONS[1].id}
        />
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className={FOOTER}>
        <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-fg-secondary">
          <span>Costo stimato</span>
          <span className="font-mono text-fg-primary">
            {empty
              ? '—'
              : estimate.isError
                ? 'non disponibile'
                : estimate.data
                  ? formatCost(estimate.data.perKind.flashcards?.costEur ?? 0)
                  : '…'}
          </span>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => setPickModel((v) => !v)} className={BTN_GHOST}>
            cambia modello
          </button>
        </div>
        <button type="submit" disabled={busy || empty} className={`${BTN_PRIMARY} max-md:h-12`}>
          {busy ? 'Avvio…' : 'Genera flashcard'}
        </button>
      </div>
    </form>
  );
}

export type { DocumentDto };
