import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { documents, examProfiles, subjects, type ExamProfileRow } from '@studyhub/db';
import { resolveSubjectSubpath } from '@studyhub/core';
import {
  EXAM_PROFILE_PROMPT_VERSION,
  ExamProfileSchema,
  estimateCostEur,
  resolveProvider,
  type AiProvider,
} from '@studyhub/ai';
import type { ExtractExamProfileJobInput } from '@studyhub/contracts';
import { checkBudget, computeJobKey, resolveScopeChunks } from '../generation/shared.js';

const MODEL_ROUTING_EXAM_PROFILE = 'claude-haiku-4-5-20251001'; // docs/03 §4: "haiku per estrarre"

export interface ExtractExamProfileResult {
  profileId: string;
  /** True when an edited profile was kept as-is (no provider call, no cost). */
  skippedEdited: boolean;
  idempotent: boolean;
  jobKey: string;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `extract_exam_profile` (docs/03-ai-e-worker.md §2, docs/fasi/F5): from the
 * subject's past exams (`documents.type = 'esami'`) to how the course examines.
 * The user owns the profile once edited: re-extraction never silently
 * overwrites their corrections unless explicitly asked to.
 */
export async function processExtractExamProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: ExtractExamProfileJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<ExtractExamProfileResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const [existing]: ExamProfileRow[] = await db
    .select()
    .from(examProfiles)
    .where(eq(examProfiles.subjectId, input.subjectId));

  const zero = { costEur: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  if (existing?.edited && !input.overwriteEdited) {
    return { profileId: existing.id, skippedEdited: true, idempotent: false, jobKey: '', ...zero };
  }

  let docIds = input.docIds;
  if (!docIds || docIds.length === 0) {
    const examDocs: { id: string }[] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.subjectId, input.subjectId),
          eq(documents.type, 'esami'),
          eq(documents.status, 'parsed'),
        ),
      );
    docIds = examDocs.map((d) => d.id);
  }
  if (docIds.length === 0) {
    throw new Error(
      'Nessun esame passato con testo estratto: carica i PDF degli esami come tipo \'esami\' e attendi lo stato "Pronto".',
    );
  }

  const model = input.model ?? MODEL_ROUTING_EXAM_PROFILE;
  const sortedDocIds = [...docIds].sort();
  const jobKey = computeJobKey({
    type: 'extract_exam_profile',
    subjectId: input.subjectId,
    docIds: sortedDocIds,
    promptVersion: EXAM_PROFILE_PROMPT_VERSION,
    model,
  });

  // Same inputs as the profile already stored and not edited since: nothing to re-spend.
  if (existing && !existing.edited && existing.jobKey === jobKey) {
    return { profileId: existing.id, skippedEdited: false, idempotent: true, jobKey, ...zero };
  }

  const chunks = await resolveScopeChunks(db, input.subjectId, { docIds: sortedDocIds });
  const result = await provider.extractExamProfile({ subjectName: subject.name, chunks }, model);
  const profile = ExamProfileSchema.parse(result.data); // defense in depth: never trust the provider's shape

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const now = new Date();
  let profileId: string;
  if (existing) {
    profileId = existing.id;
    await db
      .update(examProfiles)
      .set({
        sourceDocIds: sortedDocIds,
        profile,
        edited: false,
        model: result.model,
        promptVersion: result.promptVersion,
        jobKey,
        updatedAt: now,
      })
      .where(eq(examProfiles.id, existing.id));
  } else {
    profileId = randomUUID();
    await db.insert(examProfiles).values({
      id: profileId,
      subjectId: input.subjectId,
      sourceDocIds: sortedDocIds,
      profile,
      model: result.model,
      promptVersion: result.promptVersion,
      jobKey,
    });
  }

  // docs/03 §2: `exam_profile.json` also lives on disk, next to the subject's other local state.
  const stateDir = resolveSubjectSubpath(subject.slug, ['.studyhub'], dataRoot);
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    join(stateDir, 'exam_profile.json'),
    JSON.stringify(
      {
        generatedBy: 'studyhub-worker',
        model: result.model,
        promptVersion: result.promptVersion,
        sourceDocIds: sortedDocIds,
        updatedAt: now.toISOString(),
        profile,
      },
      null,
      2,
    ),
    'utf-8',
  );

  return {
    profileId,
    skippedEdited: false,
    idempotent: false,
    jobKey,
    costEur,
    usage: result.usage,
  };
}
