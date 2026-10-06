import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { artifactSources, artifacts, subjects } from '@studyhub/db';
import { resolveSubjectSubpath } from '@studyhub/core';
import {
  resolveProvider,
  estimateCostEur,
  SUMMARY_PROMPT_VERSION,
  type AiProvider,
  resolveModel,
} from '@studyhub/ai';
import type { GenerateSummaryJobInput } from '@studyhub/contracts';
import {
  checkBudget,
  computeJobKey,
  findIdempotentArtifactId,
  resolveScopeChunks,
} from './shared.js';

const MODEL_ROUTING_SUMMARY = 'claude-sonnet-5-5'; // docs/03-ai-e-worker.md §4

export interface GenerateSummaryResult {
  artifactId: string;
  idempotent: boolean;
  jobKey: string;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/** `generate_summary` (docs/03-ai-e-worker.md §3.3, docs/fasi/F3-ai-core.md). */
export async function processGenerateSummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: GenerateSummaryJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<GenerateSummaryResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const model = input.model ?? resolveModel(MODEL_ROUTING_SUMMARY);
  const scopeChunks = await resolveScopeChunks(db, input.subjectId, input.scope);

  const jobKey = computeJobKey({
    type: 'generate_summary',
    subjectId: input.subjectId,
    docIds: [...(input.scope.docIds ?? [])].sort(),
    promptVersion: SUMMARY_PROMPT_VERSION,
    model,
    length: input.length,
  });

  const existingArtifactId = await findIdempotentArtifactId(db, jobKey);
  if (existingArtifactId) {
    return {
      artifactId: existingArtifactId,
      idempotent: true,
      jobKey,
      costEur: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const result = await provider.generateSummary(
    { subjectName: subject.name, chunks: scopeChunks, length: input.length },
    model,
  );

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const artifactId = randomUUID();
  const uniqueDocIds = [...new Set(scopeChunks.map((c) => c.docId))];
  const artifactDir = resolveSubjectSubpath(subject.slug, ['artifacts', 'summaries'], dataRoot);
  await fs.mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `${artifactId}.md`);

  const frontMatter = [
    '---',
    `generatedBy: studyhub-worker`,
    `model: ${result.model}`,
    `promptVersion: ${result.promptVersion}`,
    `sourceDocIds: [${uniqueDocIds.join(', ')}]`,
    `approvedAt: null`,
    `createdAt: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n');
  await fs.writeFile(artifactPath, frontMatter + result.data.markdown, 'utf-8');

  await db.insert(artifacts).values({
    id: artifactId,
    subjectId: input.subjectId,
    kind: 'summary',
    title: `Riassunto — ${subject.name}`,
    path: artifactPath,
    model: result.model,
    promptVersion: result.promptVersion,
    costEur,
  });
  if (uniqueDocIds.length > 0) {
    await db
      .insert(artifactSources)
      .values(uniqueDocIds.map((documentId) => ({ artifactId, documentId })));
  }

  return { artifactId, idempotent: false, jobKey, costEur, usage: result.usage };
}
