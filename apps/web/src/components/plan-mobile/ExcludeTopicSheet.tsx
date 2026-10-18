'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { excludableTopics } from '@/lib/planMobile';
import type { PlanDto } from '@studyhub/contracts';
import { primaryButton, secondaryButton } from '../simulation-mobile/styles';
import { BottomSheet } from '../subject-mobile/BottomSheet';

const dangerButton =
  'flex w-full min-h-12 items-center justify-center rounded-[var(--radius-control)] border border-danger px-4 text-sm font-semibold text-danger disabled:opacity-50';

/**
 * Pick one topic to drop. On a draft the exclusion is immediate; on an active plan a second
 * step confirms how many lessons will be marked as skipped. A refused action shows why.
 */
export function ExcludeTopicSheet({
  open,
  onOpenChange,
  plan,
  hasDraft,
  returnFocusRef,
  pending,
  error,
  onExclude,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlanDto | null;
  hasDraft: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  pending: boolean;
  error: string | null;
  onExclude: (topicKey: string, openCount: number) => void;
}) {
  const [picked, setPicked] = useState('');
  const [view, setView] = useState<'pick' | 'confirm'>('pick');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (open) {
      setPicked('');
      setView('pick');
    }
  }, [open]);
  useEffect(() => {
    if (view === 'confirm') headingRef.current?.focus();
  }, [view]);

  const active = plan?.status === 'active';
  const topics = excludableTopics(plan);
  const chosen = topics.find((t) => t.key === picked) ?? null;
  const confirming = active && view === 'confirm' && chosen !== null;
  const n = chosen?.openCount ?? 0;

  const errorNode = error && (
    <p role="alert" className="mt-2 text-sm text-danger">
      {error}
    </p>
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Escludi un argomento"
      description={
        active
          ? 'Le sue lezioni ancora da fare vengono segnate come saltate; quelle già fatte restano.'
          : 'Le sue task escono dalla bozza.'
      }
      returnFocusRef={returnFocusRef}
    >
      {confirming ? (
        <div className="mt-3 flex flex-col gap-2">
          <h3 tabIndex={-1} ref={headingRef} className="break-words text-base font-semibold">
            Escludere «{chosen.label}»?
          </h3>
          <p data-testid="plan-exclude-confirm-text" className="text-sm font-medium">
            {n === 1
              ? '1 lezione verrà segnata come saltata.'
              : `${n} lezioni verranno segnate come saltate.`}
          </p>
          <p className="text-sm text-fg-secondary">
            Quelle già fatte restano. Non vengono ridistribuite: puoi riaprire una lezione saltata
            dal suo dettaglio.
          </p>
          {hasDraft && (
            <p className="text-xs text-fg-muted">
              La bozza in attesa non cambia: se la confermi, sostituisce queste modifiche.
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            data-testid="plan-exclude-confirm"
            onClick={() => onExclude(chosen.key, n)}
            className={`${dangerButton} mt-1`}
          >
            {pending ? 'Salto…' : 'Segna come saltate'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setView('pick');
              setTimeout(
                () =>
                  fieldsetRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus(),
                0,
              );
            }}
            className={`${secondaryButton} min-h-12`}
          >
            Indietro
          </button>
          {errorNode}
        </div>
      ) : (
        <>
          <fieldset ref={fieldsetRef} className="mt-3 flex flex-col gap-1.5">
            <legend className="sr-only">Argomento da escludere</legend>
            {topics.map((t) => (
              <label
                key={t.key}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-3 text-sm ${
                  picked === t.key ? 'border-accent bg-accent-subtle' : 'border-border bg-bg-raised'
                }`}
              >
                <input
                  type="radio"
                  name="exclude-topic"
                  value={t.key}
                  checked={picked === t.key}
                  onChange={() => setPicked(t.key)}
                  className="size-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 break-words">{t.label}</span>
                {active && (
                  <span className="shrink-0 font-mono text-xs text-fg-muted">
                    {t.openCount} da fare
                  </span>
                )}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={!picked || pending}
            onClick={() => (active ? setView('confirm') : onExclude(picked, n))}
            className={`${primaryButton} mt-3 min-h-12 text-sm`}
          >
            {active ? 'Continua' : pending ? 'Escludo…' : 'Escludi'}
          </button>
          {errorNode}
        </>
      )}
    </BottomSheet>
  );
}
