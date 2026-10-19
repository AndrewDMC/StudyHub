'use client';

import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { FOCUS } from '../shared/styles';

/** `#Teoremi ` -> `Teoremi`: tags are stored trimmed, without the leading hash. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().slice(0, 40);
}

/** Chips plus a text input; Invio or virgola adds, Backspace on an empty input removes the last. */
export function TagInput({
  value,
  onChange,
  label = 'Tag',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState('');
  const id = useId();

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag && !value.includes(tag) && value.length < 20) onChange([...value, tag]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-fg-secondary">
        {label}
      </label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-border-strong bg-bg-inset p-1 focus-within:outline-2 focus-within:outline-accent">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-bg-raised py-0.5 pl-2.5 pr-1 text-xs text-fg-primary"
          >
            #{tag}
            <button
              type="button"
              aria-label={`Rimuovi tag ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className={`flex min-h-6 min-w-6 items-center justify-center rounded-full text-fg-secondary hover:text-fg-primary ${FOCUS}`}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder="Aggiungi tag"
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) add(v.slice(0, -1));
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() !== '' && add(draft)}
          className="min-w-24 flex-1 bg-transparent px-2 py-1 text-sm text-fg-primary outline-none max-md:text-base"
        />
      </div>
    </div>
  );
}
