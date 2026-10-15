import type { DocumentStatusView } from '@/lib/documentStatus';

/** Status pill: always carries text, the tone only reinforces it. */
export function StatusPill({ view }: { view: DocumentStatusView }) {
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs"
      style={{
        color: view.tone,
        borderColor: `color-mix(in srgb, ${view.tone} 40%, transparent)`,
      }}
    >
      {view.label}
    </span>
  );
}
