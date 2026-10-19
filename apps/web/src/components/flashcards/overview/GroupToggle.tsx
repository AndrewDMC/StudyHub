'use client';

import { Segmented } from '@/components/ui/segmented';
import type { FlashcardGroup } from '@/lib/flashcardsView';

/** "Raggruppa per" Argomento | Mazzo. */
export function GroupToggle({
  value,
  onChange,
}: {
  value: FlashcardGroup;
  onChange: (value: FlashcardGroup) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-fg-secondary">Raggruppa per</span>
      <Segmented
        aria-label="Raggruppa"
        value={value}
        onChange={(v) => onChange(v as FlashcardGroup)}
        options={[
          { value: 'argomento', label: 'Argomento' },
          { value: 'mazzo', label: 'Mazzo' },
        ]}
      />
    </div>
  );
}
