'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Archive,
  ArchiveRestore,
  Check,
  ClipboardCheck,
  Layers,
  ListTree,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { DocumentDto, SubjectDto, TopicDto } from '@studyhub/contracts';
import { SIMULATION_DRILL_MAX_TOPICS } from '@studyhub/core/browser';
import { useSelection } from '@/lib/selection';
import { MODEL_OPTIONS } from '../ModelPicker';
import { enqueue, fetchEstimate, formatCost, scopeKey, type ScopeInput } from '../GenerationPanel';
import { postJson } from '../ExamPrepPanel';
import { useSubjectActions } from '../SubjectActions';
import type { AskScope } from '@/lib/askStream';
import { AskSubject } from './AskSubject';
import { BottomSheet } from './BottomSheet';
import { SectionError, SkeletonRows } from './SectionState';

type GenKind = 'flashcards' | 'summary' | 'schema' | 'exercises';

const GEN_TILES: { kind: GenKind; label: string; verb: string; Icon: typeof Layers }[] = [
  { kind: 'flashcards', label: 'Flashcard', verb: 'flashcard', Icon: Layers },
  { kind: 'summary', label: 'Riassunto', verb: 'riassunto', Icon: Pencil },
  { kind: 'schema', label: 'Schema', verb: 'schema', Icon: ListTree },
  { kind: 'exercises', label: 'Esercizi', verb: 'esercizi', Icon: ClipboardCheck },
];

const rowClass =
  'flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-[15px] text-fg-primary hover:bg-bg-raised disabled:opacity-50';

/**
 * "Assistente" bottom sheet (docs/design/materia-mobile/Azioni.dc.html): generation scope + kind,
 * estimated cost, and the subject's own actions. Reuses GenerationPanel's requests and
 * SubjectActions' mutations — no AI logic of its own.
 */
export function AssistantSheet({
  open,
  onOpenChange,
  slug,
  subject,
  documents,
  topics,
  onPickMaterial,
  onEdit,
  returnFocusRef,
  loadState,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  subject: SubjectDto;
  documents: DocumentDto[];
  topics: TopicDto[];
  /** "+ Scegli": closes the sheet and takes the user to Materiale. */
  onPickMaterial: () => void;
  /** "Modifica materia": closes the sheet and opens the edit dialog. */
  onEdit: () => void;
  /** Element that opened the sheet: gets the focus back on close. */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Documents still loading or failed (only the Piano host loads them lazily): replaces the generation part. */
  loadState?: { loading: boolean; error: string | null; onRetry: () => void } | undefined;
}) {
  const [kind, setKind] = useState<GenKind>('flashcards');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [model] = useState<string>(MODEL_OPTIONS[1].id); // same default routing as GenerationPanel
  const { docIds, topicIds, toggleTopic, setDocIds } = useSelection();
  const queryClient = useQueryClient();
  const { isArchived, archiveMutation, deleteMutation } = useSubjectActions(subject);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) setConfirmingDelete(false);
  }, [open]);

  // Same scope rules as GenerationPanel: explicit documents > topics > every parsed document.
  const parsedDocIds = documents.filter((d) => d.status === 'parsed').map((d) => d.id);
  const explicitDocIds = docIds.size > 0 ? parsedDocIds.filter((id) => docIds.has(id)) : [];
  const useTopicScope = explicitDocIds.length === 0 && topicIds.size > 0;
  const scope: ScopeInput = useTopicScope
    ? { topicIds: [...topicIds] }
    : { docIds: explicitDocIds.length > 0 ? explicitDocIds : parsedDocIds };
  const scopeEmpty = 'docIds' in scope ? scope.docIds.length === 0 : scope.topicIds.length === 0;

  const estimate = useQuery({
    queryKey: ['generation-estimate', slug, model, scopeKey(scope)],
    queryFn: () => fetchEstimate(slug, scope, model),
    enabled: open && !scopeEmpty,
  });

  const generate = useMutation({
    mutationFn: () =>
      kind === 'exercises'
        ? postJson(`/api/subjects/${slug}/simulations`, {
            mode: 'drill_argomento',
            topicIds: [...topicIds],
            model,
          })
        : enqueue(slug, kind, scope, model),
    onSuccess: () => {
      if (kind === 'exercises') {
        queryClient.invalidateQueries({ queryKey: ['simulations', slug] });
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ['simulations', slug] }), 3000);
      } else {
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ['artifacts', slug] }), 3000);
      }
    },
  });

  // Exercises are a topic drill: documents are ignored, 1..5 topics are needed.
  const isExercises = kind === 'exercises';
  const exercisesHint = !isExercises
    ? null
    : topicIds.size === 0
      ? 'Scegli almeno un argomento'
      : topicIds.size > SIMULATION_DRILL_MAX_TOPICS
        ? `Massimo ${SIMULATION_DRILL_MAX_TOPICS} argomenti`
        : null;
  const askScope: AskScope =
    explicitDocIds.length > 0
      ? { docIds: explicitDocIds }
      : useTopicScope
        ? { topicIds: [...topicIds] }
        : {};

  const selectKind = (next: GenKind) => {
    setKind(next);
    generate.reset();
  };

  const activeTile = GEN_TILES.find((t) => t.kind === kind) ?? GEN_TILES[0]!;
  const costEntry = estimate.data?.perKind[isExercises ? 'simulation' : kind];

  const onTileKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = (index + delta + GEN_TILES.length) % GEN_TILES.length;
    selectKind(GEN_TILES[next]!.kind);
    tileRefs.current[next]?.focus();
  };

  const actionError = (archiveMutation.error ?? deleteMutation.error) as Error | null;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={confirmingDelete ? 'Sposta nel cestino' : 'Assistente'}
      description={confirmingDelete ? undefined : 'Lavora sul materiale selezionato'}
      returnFocusRef={returnFocusRef}
    >
      {confirmingDelete ? (
        <div className="pt-2">
          <p className="text-sm text-fg-secondary">
            Sposta <code className="break-all font-mono">{subject.folderPath}</code> in{' '}
            <code className="font-mono">.trash/</code>. Confermi?
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => setConfirmingDelete(false)}
              className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-border-strong text-sm"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
              className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-danger text-sm font-medium text-danger disabled:opacity-50"
            >
              Sì, sposta nel cestino
            </button>
          </div>
          {deleteMutation.isError && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {(deleteMutation.error as Error).message}
            </p>
          )}
        </div>
      ) : (
        <>
          {loadState?.loading ? (
            <div role="status" aria-busy="true" className="mt-3">
              <span className="sr-only">Carico i documenti…</span>
              <SkeletonRows count={3} />
            </div>
          ) : loadState?.error ? (
            <div className="mt-3">
              <SectionError message={loadState.error} onRetry={loadState.onRetry} />
            </div>
          ) : (
            <>
              <div
                role="group"
                aria-label="Materiale selezionato"
                className="mt-3 flex flex-wrap gap-x-2 gap-y-0"
              >
                {topics.map((t) => {
                  const selected = topicIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTopic(t.id)}
                      className="flex min-h-11 items-center"
                    >
                      <span
                        className={`flex min-h-9 items-center gap-1 rounded-full border px-3 text-[13px] ${
                          selected
                            ? 'border-accent bg-accent-subtle text-fg-primary'
                            : 'border-border text-fg-secondary'
                        }`}
                      >
                        {selected && (
                          <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                        )}
                        {t.name}
                      </span>
                    </button>
                  );
                })}
                {explicitDocIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDocIds(new Set())}
                    aria-label={`${explicitDocIds.length} ${explicitDocIds.length === 1 ? 'documento selezionato' : 'documenti selezionati'}: tocca per toglierli`}
                    className="flex min-h-11 items-center"
                  >
                    <span className="flex min-h-9 items-center gap-1 rounded-full border border-accent bg-accent-subtle px-3 text-[13px]">
                      {explicitDocIds.length}{' '}
                      {explicitDocIds.length === 1 ? 'documento' : 'documenti'}
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </button>
                )}
                {explicitDocIds.length === 0 && topicIds.size === 0 && (
                  <span className="flex min-h-9 items-center self-center rounded-full border border-border px-3 text-[13px] text-fg-secondary">
                    Tutti i documenti pronti ({parsedDocIds.length})
                  </span>
                )}
                <button
                  type="button"
                  onClick={onPickMaterial}
                  className="flex min-h-11 items-center rounded-full border border-dashed border-border-strong px-3 text-[13px] text-fg-secondary"
                >
                  + Scegli
                </button>
              </div>
              {!isExercises && explicitDocIds.length > 0 && topicIds.size > 0 && (
                <p className="mt-1 text-xs text-fg-muted">
                  Hai scelto dei documenti: gli argomenti selezionati non vengono usati.
                </p>
              )}

              <div
                role="radiogroup"
                aria-label="Cosa generare"
                className="mt-4 grid grid-cols-2 gap-2"
              >
                {GEN_TILES.map((tile, i) => {
                  const selected = tile.kind === kind;
                  return (
                    <button
                      key={tile.kind}
                      ref={(el) => {
                        tileRefs.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      data-testid={`gen-tile-${tile.kind}`}
                      onClick={() => selectKind(tile.kind)}
                      onKeyDown={(e) => onTileKeyDown(e, i)}
                      className={`relative flex min-h-[72px] flex-col items-start justify-center gap-1.5 rounded-[var(--radius-card)] border p-3 text-left text-sm ${
                        selected
                          ? 'border-accent bg-accent-subtle text-fg-primary'
                          : 'border-border bg-bg-raised text-fg-secondary'
                      }`}
                    >
                      <tile.Icon
                        className={`h-[18px] w-[18px] ${selected ? 'text-accent' : ''}`}
                        aria-hidden="true"
                      />
                      {tile.label}
                      {selected && (
                        <Check
                          className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-accent"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {isExercises ? (
                <div className="mt-3 text-[13px] text-fg-secondary">
                  {exercisesHint ? (
                    <p id="exercises-hint" data-testid="exercises-hint">
                      {exercisesHint}
                    </p>
                  ) : (
                    <p>
                      Esercizi su {topicIds.size} {topicIds.size === 1 ? 'argomento' : 'argomenti'}
                      {costEntry ? ` · Costo stimato: ${formatCost(costEntry.costEur)}` : ''}
                    </p>
                  )}
                  {explicitDocIds.length > 0 && (
                    <p className="mt-1 text-xs text-fg-muted">
                      Gli esercizi usano gli argomenti, non i documenti.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-[13px] text-fg-secondary">
                  {scopeEmpty
                    ? 'Nessun documento con testo estratto. Carica un PDF e attendi lo stato "Pronto".'
                    : estimate.isLoading
                      ? 'Stima in corso…'
                      : estimate.isError || !costEntry
                        ? 'Stima costo non disponibile.'
                        : `Costo stimato: ${formatCost(costEntry.costEur)}`}
                </p>
              )}
              <button
                type="button"
                data-testid="gen-submit"
                disabled={(isExercises ? exercisesHint !== null : scopeEmpty) || generate.isPending}
                aria-describedby={exercisesHint ? 'exercises-hint' : undefined}
                onClick={() => generate.mutate()}
                className="mt-2 min-h-11 w-full rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
              >
                {generate.isPending ? 'Avvio…' : `Genera ${activeTile.verb}`}
              </button>
              {generate.isError && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {(generate.error as Error).message}
                </p>
              )}
              {generate.isSuccess && isExercises && (
                <div
                  role="status"
                  data-testid="exercises-started"
                  className="mt-2 text-[13px] text-ok"
                >
                  Esercizi in preparazione.{' '}
                  <Link
                    href={`/materie/${slug}?tab=simulazioni`}
                    onClick={() => onOpenChange(false)}
                    className="inline-flex min-h-11 items-center text-accent underline"
                  >
                    Vai a Simulazioni
                  </Link>
                </div>
              )}
              {generate.isSuccess && !isExercises && (
                <p role="status" className="mt-2 text-[13px] text-ok">
                  Job avviato — l&apos;elenco si aggiorna a breve.
                </p>
              )}
              <AskSubject
                open={open}
                slug={slug}
                scope={askScope}
                scopeEmpty={scopeEmpty}
                onOpenSource={() => onOpenChange(false)}
              />
            </>
          )}

          <h3 className="mb-1 mt-5 text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">
            Materia
          </h3>
          <div className="flex flex-col">
            <button type="button" onClick={onEdit} className={rowClass}>
              <Pencil className="h-5 w-5 text-fg-secondary" aria-hidden="true" />
              Modifica materia
            </button>
            <button
              type="button"
              disabled={archiveMutation.isPending}
              onClick={() =>
                archiveMutation.mutate(!isArchived, { onSuccess: () => onOpenChange(false) })
              }
              className={rowClass}
            >
              {isArchived ? (
                <ArchiveRestore className="h-5 w-5 text-fg-secondary" aria-hidden="true" />
              ) : (
                <Archive className="h-5 w-5 text-fg-secondary" aria-hidden="true" />
              )}
              {isArchived ? 'Ripristina' : 'Archivia'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className={`${rowClass} text-danger`}
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" />
              Sposta nel cestino
            </button>
          </div>
          {actionError && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {actionError.message}
            </p>
          )}
        </>
      )}
    </BottomSheet>
  );
}
