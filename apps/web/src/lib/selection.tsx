'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Selection as first-class state (docs/fasi/F2-materie.md "Decisioni" — `SelectionContext`):
 * documents and topics selected on the current subject page, shared by the Argomenti tree, every
 * tab and the AI panel. Lives above the tabs (in `SubjectDetailClient`) so switching tabs never
 * loses a selection made on another one.
 */
export interface SelectionValue {
  docIds: Set<string>;
  topicIds: Set<string>;
  setDocIds: (next: Set<string>) => void;
  toggleTopic: (topicId: string) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [docIds, setDocIds] = useState<Set<string>>(new Set());
  const [topicIds, setTopicIds] = useState<Set<string>>(new Set());

  const toggleTopic = (topicId: string) => {
    setTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  };

  const clear = () => {
    setDocIds(new Set());
    setTopicIds(new Set());
  };

  const value = useMemo<SelectionValue>(
    () => ({ docIds, topicIds, setDocIds, toggleTopic, clear }),
    [docIds, topicIds],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('useSelection must be used within a SelectionProvider');
  return ctx;
}
