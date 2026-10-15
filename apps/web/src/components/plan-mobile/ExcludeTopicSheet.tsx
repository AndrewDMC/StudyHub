'use client';

import { useEffect, useState, type RefObject } from 'react';
import { excludableTopics } from '@/lib/planMobile';
import type { PlanDto } from '@studyhub/contracts';
import { primaryButton } from '../simulation-mobile/styles';
import { BottomSheet } from '../subject-mobile/BottomSheet';

/** Pick one topic of the draft to drop; a refused action shows why and changes nothing. */
export function ExcludeTopicSheet({
  open,
  onOpenChange,
  plan,
  returnFocusRef,
  pending,
  error,
  onExclude,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlanDto | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  pending: boolean;
  error: string | null;
  onExclude: (topicKey: string) => void;
}) {
  const [picked, setPicked] = useState('');
  useEffect(() => {
    if (open) setPicked('');
  }, [open]);
  const topics = excludableTopics(plan);

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Escludi un argomento"
      description="Le sue task escono dalla bozza."
      returnFocusRef={returnFocusRef}
    >
      <fieldset className="mt-3 flex flex-col gap-1.5">
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
            <span className="min-w-0 break-words">{t.label}</span>
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        disabled={!picked || pending}
        onClick={() => onExclude(picked)}
        className={`${primaryButton} mt-3 min-h-12 text-sm`}
      >
        {pending ? 'Escludo…' : 'Escludi'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </BottomSheet>
  );
}
