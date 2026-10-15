'use client';

import { useEffect, useId, useState, type RefObject } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { fetchEstimate, formatCost, postJson, type SimScope } from '../ExamPrepPanel';
import { MODEL_OPTIONS } from '../ModelPicker';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { fieldClass, primaryButton, secondaryButton } from './styles';

export type GenerateMode = 'esame_completo' | 'drill_argomento';

/** Confirmation of a full simulation / a topic drill: topic, model and the estimated cost. */
export function GenerateSheet({
  slug,
  mode,
  documents,
  topics,
  open,
  onOpenChange,
  onStarted,
  returnFocusRef,
  initialTopicId,
}: {
  slug: string;
  mode: GenerateMode;
  documents: DocumentDto[];
  topics: TopicDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the job is enqueued, with a label for the "in generazione" row. */
  onStarted: (label: string) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Topic preselected in drill mode (e.g. from the Lacune tab). */
  initialTopicId?: string | undefined;
}) {
  const drill = mode === 'drill_argomento';
  const topicId = useId();
  const modelId = useId();
  const [drillTopic, setDrillTopic] = useState('');
  const [model, setModel] = useState<string>(MODEL_OPTIONS[2].id); // opus: default routing per generate_simulation

  // generate_simulation draws items only from study material, never the past exams the profile
  // itself came from (docs/fasi/F5) — the estimate scope mirrors that.
  const studyDocIds = documents
    .filter((d) => d.status === 'parsed' && d.type !== 'esami')
    .map((d) => d.id);
  const scope: SimScope | null = drill
    ? drillTopic
      ? { topicIds: [drillTopic] }
      : null
    : studyDocIds.length > 0
      ? { docIds: studyDocIds }
      : null;
  const estimate = useQuery({
    queryKey: [
      'generation-estimate',
      slug,
      model,
      drill ? `t:${drillTopic}` : `d:${studyDocIds.join(',')}`,
    ],
    queryFn: () => fetchEstimate(slug, scope!, model),
    enabled: open && scope !== null,
  });

  const generate = useMutation({
    mutationFn: () =>
      postJson(`/api/subjects/${slug}/simulations`, {
        mode,
        ...(drill ? { topicId: drillTopic } : {}),
        model,
      }),
    onSuccess: () => {
      const name = topics.find((t) => t.id === drillTopic)?.name;
      onStarted(drill ? `Drill · ${name ?? 'Argomento'}` : 'Simulazione completa');
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (open) {
      setDrillTopic(initialTopicId ?? '');
      generate.reset();
    }
  }, [open]);

  let costText: string | null = null;
  if (scope === null) {
    costText = drill ? null : 'Stima non disponibile: carica prima del materiale.';
  } else if (estimate.isFetching) {
    costText = 'Calcolo la stima…';
  } else if (estimate.isError) {
    costText = 'Stima non disponibile.';
  } else if (estimate.data) {
    costText = `Costo stimato: ${formatCost(estimate.data.perKind.simulation!.costEur)}`;
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={drill ? 'Drill su un argomento' : 'Nuova simulazione completa'}
      description={
        drill
          ? "Un'esercitazione mirata su un solo argomento."
          : "Una prova con formato e punti del profilo dell'esame."
      }
      returnFocusRef={returnFocusRef}
    >
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          generate.mutate();
        }}
      >
        {drill && (
          <div className="flex flex-col gap-1">
            <label htmlFor={topicId} className="text-xs text-fg-secondary">
              Argomento
            </label>
            <select
              id={topicId}
              value={drillTopic}
              onChange={(e) => setDrillTopic(e.target.value)}
              className={fieldClass}
            >
              <option value="" disabled>
                Scegli un argomento…
              </option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={modelId} className="text-xs text-fg-secondary">
            Modello AI
          </label>
          <select
            id={modelId}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={fieldClass}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <p role="status" className="min-h-5 text-[13px] text-fg-secondary">
          {costText}
        </p>
        {generate.isError && (
          <p role="alert" className="text-sm text-danger">
            {(generate.error as Error).message}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={`${secondaryButton} min-h-12`}
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={generate.isPending || (drill && !drillTopic)}
            className={`${primaryButton} min-h-12 text-sm`}
          >
            {generate.isPending ? 'Genero…' : 'Genera'}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
