/** 90 -> "1 h 30 min"; null -> "—". */
export function formatExamDuration(min: number | null): string {
  if (min === null) return '—';
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
