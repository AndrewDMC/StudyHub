import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray, ne } from 'drizzle-orm';
import {
  artifactSources,
  artifacts,
  documentTopics,
  documents,
  examProfiles,
  simulationItems,
  simulations,
  subjects,
  topics,
} from '@studyhub/db';
import { resolveSubjectSubpath } from '@studyhub/core';
import {
  estimateCostEur,
  ExamProfileSchema,
  resolveProvider,
  SimulationItemSchema,
  type AiProvider,
  type ExamProfile,
  type SimulationItem,
  resolveModel,
} from '@studyhub/ai';
import { resolveSimulationTopicIds, type GenerateSimulationJobInput } from '@studyhub/contracts';
import { checkBudget, resolveScopeChunks } from '../generation/shared.js';

const MODEL_ROUTING_SIMULATION = 'claude-opus-5-5'; // docs/03 §4: "opus per ragionare"
const DEFAULT_DRILL_ITEMS = 5;

/** Used for drills when no profile exists yet — a drill doesn't need to imitate the exam format. */
const DRILL_FALLBACK_PROFILE: ExamProfile = {
  itemCount: DEFAULT_DRILL_ITEMS,
  durationMin: DEFAULT_DRILL_ITEMS * 15,
  totalPoints: DEFAULT_DRILL_ITEMS * 10,
  kindDistribution: { open: 1 },
  avgMinutesPerItem: 15,
  verbosity: 'media',
  recurringTopics: [],
  notes: "Profilo di ripiego per drill (nessun profilo d'esame estratto).",
};

export interface GenerateSimulationResult {
  artifactId: string;
  itemCount: number;
  discardedCount: number;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Quality gate on generated items, never trusting the provider:
 * - the citation must be verbatim in the cited chunk (same anti-hallucination
 *   rule as flashcards — it's what the correction shows as "where to re-study");
 * - the rubric must sum to the item's points (docs/fasi/F5: rubric generated
 *   *with* the item, so asked and graded can't disagree).
 */
export function validateSimulationItem(
  item: SimulationItem,
  chunkTextByDocPage: Map<string, string>,
): boolean {
  if (!SimulationItemSchema.safeParse(item).success) return false;
  const chunk = chunkTextByDocPage.get(`${item.sourceRef.docId}:${item.sourceRef.page}`);
  if (!chunk || !chunk.includes(item.sourceRef.quote)) return false;
  const rubricTotal = item.rubric.reduce((s, r) => s + r.points, 0);
  return Math.abs(rubricTotal - item.points) < 0.01;
}

/**
 * `generate_simulation` (docs/03-ai-e-worker.md §3.4, docs/fasi/F5). No jobKey
 * idempotency on purpose: asking for a simulation is asking for a *new* one
 * ("rifare la stessa" is a new attempt on an existing simulation, not a
 * regeneration) — the budget guard still applies.
 */
export async function processGenerateSimulation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: GenerateSimulationJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<GenerateSimulationResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const [profileRow] = await db
    .select()
    .from(examProfiles)
    .where(eq(examProfiles.subjectId, input.subjectId));
  if (input.mode === 'esame_completo' && !profileRow) {
    throw new Error(
      "Estrai prima il profilo d'esame: la simulazione completa ne imita il formato.",
    );
  }
  // Stored profiles may predate `{ name, count }` topics (bare strings): the schema upgrades them,
  // so the prompt and every downstream reader (`.name`) only ever see the object form.
  const profile: ExamProfile = profileRow
    ? ExamProfileSchema.parse(profileRow.profile)
    : DRILL_FALLBACK_PROFILE;

  // A drill covers 1..5 topics: `topicIds`, or the legacy single `topicId` read as `[topicId]`.
  // Ignored in `esame_completo`, whose items are tagged against all the subject's topics instead.
  const drillTopicIds = input.mode === 'drill_argomento' ? resolveSimulationTopicIds(input) : [];
  const drillTopics: { id: string; name: string }[] = [];
  for (const id of drillTopicIds) {
    const [topic] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.id, id), eq(topics.subjectId, input.subjectId)));
    if (!topic) throw new Error(`Argomento non trovato in questa materia: ${id}`);
    drillTopics.push({ id: topic.id, name: topic.name });
  }
  const multiTopicDrill = drillTopics.length > 1;
  // Exactly one topic: the drill is "on" that topic (name, simulation.topicId, every item tagged with it).
  const topicName: string | undefined = drillTopics.length === 1 ? drillTopics[0]!.name : undefined;
  const drillTopicNames = drillTopics.map((t) => t.name);

  // Per-item topic tagging in `esame_completo` mode (docs/fasi/F5-esami-simulazioni.md
  // "Non implementato": prima solo i drill avevano un topicId, fisso e unico).
  const subjectTopics: { id: string; name: string }[] = await db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(eq(topics.subjectId, input.subjectId));
  const topicIdByName = new Map(subjectTopics.map((t) => [t.name.toLowerCase(), t.id]));

  const drillTopicIdByName = new Map(drillTopics.map((t) => [t.name.toLowerCase(), t.id]));

  let docIds = input.docIds;
  if (!docIds || docIds.length === 0) {
    // Study material, never the past exams themselves: items must be new, not copies.
    const studyDocs: { id: string }[] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.subjectId, input.subjectId),
          eq(documents.status, 'parsed'),
          ne(documents.type, 'esami'),
        ),
      );
    docIds = studyDocs.map((d) => d.id);

    // Several topics: prefer the study material tagged with any of them (union); a single-topic drill
    // keeps drawing from all the study material, and so does a multi-topic one with nothing tagged.
    if (multiTopicDrill && docIds.length > 0) {
      const linked: { documentId: string }[] = await db
        .select({ documentId: documentTopics.documentId })
        .from(documentTopics)
        .where(
          and(
            inArray(documentTopics.topicId, drillTopicIds),
            inArray(documentTopics.documentId, docIds),
          ),
        );
      if (linked.length > 0) docIds = [...new Set(linked.map((l) => l.documentId))];
    }
  }
  if (docIds.length === 0) {
    throw new Error(
      'Nessun materiale di studio con testo estratto da cui generare la simulazione.',
    );
  }
  const chunks = await resolveScopeChunks(db, input.subjectId, { docIds });

  const itemCount =
    input.itemCount ?? (input.mode === 'esame_completo' ? profile.itemCount : DEFAULT_DRILL_ITEMS);
  const model = input.model ?? resolveModel(MODEL_ROUTING_SIMULATION);
  const result = await provider.generateSimulation(
    {
      subjectName: subject.name,
      chunks,
      profile,
      mode: input.mode,
      itemCount,
      difficulty: input.difficulty,
      topicName,
      topicNames: multiTopicDrill ? drillTopicNames : undefined,
      topics: subjectTopics,
    },
    model,
  );

  const chunkTextByDocPage = new Map(chunks.map((c) => [`${c.docId}:${c.page}`, c.text]));
  const kept = result.data.items.filter((item) => validateSimulationItem(item, chunkTextByDocPage));
  const discardedCount = result.data.items.length - kept.length;
  if (kept.length === 0) {
    throw new Error(
      `Tutti i ${result.data.items.length} esercizi generati sono stati scartati (citazione non verbatim o rubrica incoerente).`,
    );
  }

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const artifactId = randomUUID();
  const totalPoints = Math.round(kept.reduce((s, i) => s + i.points, 0) * 100) / 100;
  const uniqueDocIds = [...new Set(kept.map((i) => i.sourceRef.docId))];
  const title =
    input.mode === 'esame_completo'
      ? `Simulazione d'esame — ${kept.length} esercizi`
      : `Drill — ${drillTopicNames.length > 0 ? drillTopicNames.join(', ') : 'argomento'} (${kept.length} esercizi)`;

  const dir = resolveSubjectSubpath(subject.slug, ['artifacts', 'simulations'], dataRoot);
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, `${artifactId}.json`);
  await fs.writeFile(
    path,
    JSON.stringify(
      {
        generatedBy: 'studyhub-worker',
        model: result.model,
        promptVersion: result.promptVersion,
        sourceDocIds: uniqueDocIds,
        approvedAt: null,
        createdAt: new Date().toISOString(),
        mode: input.mode,
        topic: topicName ?? null,
        ...(multiTopicDrill ? { topics: drillTopicNames } : {}),
        timeBudgetMin: result.data.timeBudgetMin,
        items: kept,
      },
      null,
      2,
    ),
    'utf-8',
  );

  await db.insert(artifacts).values({
    id: artifactId,
    subjectId: input.subjectId,
    kind: 'simulation',
    title,
    path,
    model: result.model,
    promptVersion: result.promptVersion,
    costEur,
  });
  await db.insert(simulations).values({
    artifactId,
    mode: input.mode,
    // A multi-topic drill has no single topic: its items carry theirs.
    topicId: drillTopics.length === 1 ? drillTopics[0]!.id : null,
    timeBudgetMin: result.data.timeBudgetMin,
    totalPoints,
  });
  await db.insert(simulationItems).values(
    kept.map((item, ord) => ({
      id: randomUUID(),
      simulationId: artifactId,
      ord,
      topicId:
        drillTopics.length === 1
          ? drillTopics[0]!.id
          : ((multiTopicDrill ? drillTopicIdByName : topicIdByName).get(
              item.topicName?.toLowerCase() ?? '',
            ) ?? null),
      prompt: item.prompt,
      kind: item.kind,
      points: item.points,
      expectedPoints: item.expectedPoints,
      rubric: item.rubric,
      solution: item.solution,
      sourceRef: item.sourceRef,
    })),
  );
  await db
    .insert(artifactSources)
    .values(uniqueDocIds.map((documentId) => ({ artifactId, documentId })));

  return { artifactId, itemCount: kept.length, discardedCount, costEur, usage: result.usage };
}
