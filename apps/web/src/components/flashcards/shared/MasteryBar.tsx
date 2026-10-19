/** Bar (hidden from AT) plus the percentage in text; `null` mastery = never reviewed. */
export function MasteryBar({
  mastery,
  className = '',
}: {
  mastery: number | null;
  className?: string;
}) {
  if (mastery === null) {
    return <span className={`text-[13px] text-fg-secondary ${className}`}>Mai ripassato</span>;
  }
  const pct = Math.round(mastery * 100);
  const tone = pct >= 70 ? 'bg-ok' : pct >= 40 ? 'bg-warn' : 'bg-danger';
  return (
    <span className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <span aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-9 shrink-0 text-right font-mono text-xs text-fg-primary">{pct}%</span>
    </span>
  );
}
