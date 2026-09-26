import { desc, eq } from 'drizzle-orm';
import { transcriptionCorrections } from '@studyhub/db';
import { estimateCostEur, resolveProvider, type AiProvider } from '@studyhub/ai';
import type { DistillHandwritingProfileJobInput } from '@studyhub/contracts';
import {
  appendHandwritingProfileLines,
  subjectHandwritingProfilePath,
} from './handwritingProfile.js';

const MODEL_ROUTING_DISTILL = 'claude-haiku-4-5-20251001'; // "haiku per estrarre" — negligible cost
const MAX_CORRECTIONS = 20;

export interface DistillHandwritingProfileResult {
  linesAdded: number;
  costEur: number;
}

/**
 * `distill_handwriting_profile` (docs/07-markdown-layer.md §5.4b): reads the
 * most recent corrections for a document and appends any durable
 * convention the model recognizes to `handwriting-profile.md`. Enqueued
 * after a batch of corrections are saved on the verification screen, not
 * per-correction — one call for several edits, not one per edit.
 */
export async function processDistillHandwritingProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: DistillHandwritingProfileJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<DistillHandwritingProfileResult> {
  const model = input.model ?? MODEL_ROUTING_DISTILL;

  const corrections: { before: string | null; after: string | null; kind: string | null }[] =
    await db
      .select({
        before: transcriptionCorrections.before,
        after: transcriptionCorrections.after,
        kind: transcriptionCorrections.kind,
      })
      .from(transcriptionCorrections)
      .where(eq(transcriptionCorrections.documentId, input.documentId))
      .orderBy(desc(transcriptionCorrections.createdAt))
      .limit(MAX_CORRECTIONS);

  if (corrections.length === 0) {
    return { linesAdded: 0, costEur: 0 };
  }

  const result = await provider.distillHandwritingProfile({ corrections }, model);
  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );

  if (result.data.lines.length > 0) {
    await appendHandwritingProfileLines(
      subjectHandwritingProfilePath(input.subjectSlug, dataRoot),
      result.data.lines,
    );
  }

  return { linesAdded: result.data.lines.length, costEur };
}
