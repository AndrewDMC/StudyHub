'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { GeneratePlanRequest, PlanChangeProposalDto } from '@studyhub/contracts';
import { formatEur } from '@/components/SessionChat';

async function proposeChange(
  slug: string,
  body: { instruction: string; planId: string; today: string },
): Promise<PlanChangeProposalDto> {
  const res = await fetch(`/api/subjects/${slug}/plan/change`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? 'Proposta di modifica non riuscita');
  return data as PlanChangeProposalDto;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "Modifica piano" a parole: lo studente scrive cosa cambiare, l'AI propone i nuovi parametri e li mostra;
 * solo con «Genera bozza» parte la generazione (che resta una bozza da rivedere e confermare).
 */
export function PlanChangeBox({
  slug,
  planId,
  pending,
  onConfirm,
  compact = false,
}: {
  slug: string;
  planId: string;
  /** The draft generation started from the confirmed proposal is running. */
  pending: boolean;
  onConfirm: (request: GeneratePlanRequest) => void;
  /** Mobile sheet: larger touch targets. */
  compact?: boolean;
}) {
  const [instruction, setInstruction] = useState('');
  const propose = useMutation({
    mutationFn: () =>
      proposeChange(slug, { instruction: instruction.trim(), planId, today: localToday() }),
  });
  const proposal = propose.data;
  const control = compact ? 'min-h-11 text-sm' : 'text-xs';

  return (
    <section
      aria-label="Modifica il piano a parole"
      className="space-y-2 rounded-[var(--radius-card)] border border-border bg-bg-surface p-3"
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-fg-primary">
        Cosa vuoi cambiare?
        <textarea
          value={instruction}
          onChange={(e) => {
            setInstruction(e.target.value);
            if (propose.data || propose.error) propose.reset();
          }}
          rows={2}
          maxLength={1000}
          placeholder="Es. «3 ore al giorno, sabato libero e ritmo più intenso» oppure «l'esame è spostato al 10 novembre»"
          className="w-full resize-none rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1.5 text-sm font-normal text-fg-primary outline-none focus:border-accent"
        />
      </label>

      {!proposal && (
        <button
          type="button"
          disabled={instruction.trim().length < 3 || propose.isPending}
          onClick={() => propose.mutate()}
          className={`rounded-[var(--radius-control)] border border-border px-3 py-1 text-fg-secondary hover:border-accent hover:text-fg-primary disabled:opacity-60 ${control}`}
        >
          {propose.isPending ? 'Interpreto la richiesta…' : 'Proponi modifiche'}
        </button>
      )}

      {propose.isError && (
        <p role="alert" className="text-sm text-danger">
          {(propose.error as Error).message}
        </p>
      )}

      {proposal && (
        <div className="space-y-2 text-sm" data-testid="plan-change-proposal">
          {proposal.changes.length > 0 ? (
            <>
              <p className="font-medium text-fg-primary">Ecco cosa cambierei:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-fg-secondary">
                {proposal.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-fg-secondary">Nessuna modifica applicabile alla richiesta.</p>
          )}
          {proposal.notApplied.length > 0 && (
            <div className="text-xs text-warn">
              <p>Non posso farlo con il pianificatore:</p>
              <ul className="list-disc pl-5">
                {proposal.notApplied.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-fg-muted">
            Il piano viene ricalcolato da oggi come nuova bozza: la rivedi e la confermi prima che
            sostituisca quello attuale.
            {proposal.costEur > 0 ? ` Costo della proposta: ${formatEur(proposal.costEur)}.` : ''}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || proposal.changes.length === 0}
              onClick={() => onConfirm(proposal.request)}
              className={`rounded-[var(--radius-control)] bg-accent px-3 py-1 font-medium text-white hover:bg-accent-hover disabled:opacity-60 ${control}`}
            >
              {pending ? 'Generazione…' : 'Genera bozza'}
            </button>
            <button
              type="button"
              onClick={() => propose.reset()}
              className={`rounded-[var(--radius-control)] border border-border px-3 py-1 text-fg-secondary hover:text-fg-primary ${control}`}
            >
              Annulla
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
