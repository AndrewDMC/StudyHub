'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Frown, Meh, Smile, type LucideIcon } from 'lucide-react';
import type { SessionMood, StudySessionDto } from '@studyhub/contracts';
import { patchSessionMood } from '@/lib/sessionApi';

const OPTIONS: { value: SessionMood; label: string; Icon: LucideIcon }[] = [
  { value: 'hard', label: 'Faticosa', Icon: Frown },
  { value: 'ok', label: 'Così così', Icon: Meh },
  { value: 'good', label: 'Bene', Icon: Smile },
];

/** "Com'è andata?": three radio pills saved right away; picking the selected one again clears it. */
export function MoodPicker({
  slug,
  sessionId,
  session,
  sessionKey,
  labelClass,
}: {
  slug: string;
  sessionId: string;
  session: StudySessionDto;
  sessionKey: readonly unknown[];
  labelClass: string;
}) {
  const queryClient = useQueryClient();
  const saved = session.mood ?? null;
  const [mood, setMood] = useState<SessionMood | null>(saved);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<SessionMood | null>(saved);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    latest.current = saved;
    setMood(saved);
  }, [saved]);

  const save = useMutation({
    // Serial: PATCHes sent in quick succession must reach the server in the order they were chosen.
    scope: { id: `mood-${sessionId}` },
    mutationFn: (next: SessionMood | null) => patchSessionMood(slug, sessionId, next),
    // A stale refetch must not overwrite the mood just picked.
    onMutate: () => queryClient.cancelQueries({ queryKey: sessionKey }),
    onSuccess: (dto, next) => {
      // Only the last choice counts: an older response must not overwrite a newer pick.
      if (latest.current === next) queryClient.setQueryData(sessionKey, dto);
    },
    onError: (err, next) => {
      if (latest.current !== next) return;
      latest.current = saved;
      setMood(saved);
      setError(err.message || 'Impossibile salvare. Riprova.');
    },
  });

  const choose = (next: SessionMood | null) => {
    setError(null);
    latest.current = next;
    setMood(next);
    save.mutate(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const target = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length]!;
    refs.current[target.value]?.focus();
    choose(target.value);
  };

  const tabStop = mood ?? OPTIONS[0]!.value;

  return (
    <section
      aria-labelledby="closing-mood"
      data-testid="closing-mood"
      className="flex flex-col gap-2.5"
    >
      <h2 id="closing-mood" className={labelClass}>
        Com&apos;è andata?
      </h2>
      <div role="radiogroup" aria-labelledby="closing-mood" className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ value, label, Icon }, i) => {
          const checked = mood === value;
          return (
            <button
              key={value}
              ref={(el) => {
                refs.current[value] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={tabStop === value ? 0 : -1}
              data-testid={`mood-${value}`}
              onClick={() => choose(checked ? null : value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`relative flex min-h-16 flex-col items-center justify-center gap-1 rounded-[10px] border text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                checked
                  ? 'border-accent bg-accent-subtle font-semibold text-fg-primary'
                  : 'border-border-strong bg-bg-raised font-medium text-fg-secondary'
              }`}
            >
              {checked && (
                <Check className="absolute right-1.5 top-1.5 size-3.5" aria-hidden="true" />
              )}
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" data-testid="mood-error" className="text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
