import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { artifactSources, artifacts, subjects } from '@studyhub/db';
import { resolveSubjectSubpath } from '@studyhub/core';
import {
  estimateCostEur,
  resolveProvider,
  SCHEMA_PROMPT_VERSION,
  type AiProvider,
  type SchemaNode,
  resolveModel,
} from '@studyhub/ai';
import type { GenerateSchemaJobInput } from '@studyhub/contracts';
import {
  checkBudget,
  computeJobKey,
  findIdempotentArtifactId,
  resolveScopeChunks,
} from './shared.js';

const MODEL_ROUTING_SCHEMA = 'claude-sonnet-5-5'; // docs/03-ai-e-worker.md §4

export interface GenerateSchemaResult {
  artifactId: string;
  idempotent: boolean;
  jobKey: string;
  nodeCount: number;
  discardedCount: number;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Same anti-hallucination rule as a flashcard's citation (docs/fasi/F3-ai-core.md "Decisioni"):
 * a node whose `sourceRef.quote` doesn't appear verbatim in the cited chunk is dropped before it
 * reaches the user. Known limitation: `markdown`/`mermaid` may still reference a dropped
 * `nodeId` — declared here rather than hidden, same as the rest of this codebase's "Stato" notes.
 */
function validateSchemaNode(node: SchemaNode, chunkTextByDocPage: Map<string, string>): boolean {
  const chunk = chunkTextByDocPage.get(`${node.sourceRef.docId}:${node.sourceRef.page}`);
  return !!chunk && chunk.includes(node.sourceRef.quote);
}

/** `generate_schema` (docs/03-ai-e-worker.md §3.2, docs/fasi/F3-ai-core.md). */
export async function processGenerateSchema(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: GenerateSchemaJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<GenerateSchemaResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const model = input.model ?? resolveModel(MODEL_ROUTING_SCHEMA);
  const scopeChunks = await resolveScopeChunks(db, input.subjectId, input.scope);

  const jobKey = computeJobKey({
    type: 'generate_schema',
    subjectId: input.subjectId,
    docIds: [...(input.scope.docIds ?? [])].sort(),
    promptVersion: SCHEMA_PROMPT_VERSION,
    model,
    depth: input.depth,
    style: input.style,
  });

  const existingArtifactId = await findIdempotentArtifactId(db, jobKey);
  if (existingArtifactId) {
    return {
      artifactId: existingArtifactId,
      idempotent: true,
      jobKey,
      nodeCount: 0,
      discardedCount: 0,
      costEur: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const result = await provider.generateSchema(
    { subjectName: subject.name, chunks: scopeChunks, depth: input.depth, style: input.style },
    model,
  );

  const chunkTextByDocPage = new Map(scopeChunks.map((c) => [`${c.docId}:${c.page}`, c.text]));
  const kept = result.data.nodes.filter((node) => validateSchemaNode(node, chunkTextByDocPage));
  const discardedCount = result.data.nodes.length - kept.length;
  if (kept.length === 0) {
    throw new Error(
      `Tutti i ${result.data.nodes.length} nodi generati sono stati scartati (citazione non verbatim).`,
    );
  }

  const costEur = estimateCostEur(
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );
  await checkBudget(db, costEur, input.force);

  const artifactId = randomUUID();
  const uniqueDocIds = [...new Set(kept.map((n) => n.sourceRef.docId))];
  const dir = resolveSubjectSubpath(subject.slug, ['artifacts', 'schemas'], dataRoot);
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
        depth: input.depth,
        style: input.style,
        markdown: result.data.markdown,
        mermaid: result.data.mermaid ?? null,
        nodes: kept,
      },
      null,
      2,
    ),
    'utf-8',
  );

  await db.insert(artifacts).values({
    id: artifactId,
    subjectId: input.subjectId,
    kind: 'schema',
    title: `Schema — ${subject.name}`,
    path,
    model: result.model,
    promptVersion: result.promptVersion,
    costEur,
  });
  if (uniqueDocIds.length > 0) {
    await db
      .insert(artifactSources)
      .values(uniqueDocIds.map((documentId) => ({ artifactId, documentId })));
  }

  return {
    artifactId,
    idempotent: false,
    jobKey,
    nodeCount: kept.length,
    discardedCount,
    costEur,
    usage: result.usage,
  };
}
