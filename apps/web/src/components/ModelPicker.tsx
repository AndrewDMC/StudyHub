'use client';

/**
 * Model routing table (docs/03-ai-e-worker.md §4) exposes three tiers for
 * scope-based generation — same model ids `packages/ai/src/pricing.ts` prices.
 */
export const MODEL_OPTIONS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — veloce ed economico' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 — bilanciato (default)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 — qualità massima' },
] as const;

export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label="Modello AI"
      className="w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary outline-none focus:border-accent disabled:opacity-50"
    >
      {MODEL_OPTIONS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
