import { z } from 'zod';

/**
 * F0 job types. Later phases (F1+) extend this union with `ingest`, `chunk`,
 * `embed`, `flashcards`, `schema`, `summary`, `simulation`, `plan`
 * (docs/01-architettura.md §1).
 */
export const JobTypeSchema = z.enum([
  'ping',
  'reconcile',
  'extract_text',
  'embed_chunks',
  'classify_document_type',
  'transcribe_schema',
  'distill_handwriting_profile',
  'generate_flashcards',
  'generate_schema',
  'generate_summary',
  'extract_exam_profile',
  'generate_simulation',
  'grade_attempt',
  'grade_item_second_opinion',
  'generate_plan',
  'extract_topics',
]);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const PingJobInputSchema = z.object({ message: z.string().optional() });
export type PingJobInput = z.infer<typeof PingJobInputSchema>;

export const ReconcileJobInputSchema = z.object({
  /** Restrict the scan to one subject slug; omit to reconcile the whole data root. */
  subjectSlug: z.string().optional(),
});
export type ReconcileJobInput = z.infer<typeof ReconcileJobInputSchema>;

/**
 * F1 deterministic slice only: extracts the text layer of a PDF (docs/fasi/F1-ingest.md
 * "Stato" addendum). OCR/vision for scans and photos is not implemented — the
 * job fails with a clear, real error message for any other MIME type.
 */
export const ExtractTextJobInputSchema = z.object({ documentId: z.string().uuid() });
export type ExtractTextJobInput = z.infer<typeof ExtractTextJobInputSchema>;

/**
 * Vision transcription of a `schemi`-type document's photo into
 * `schema_blocks` rows (docs/fasi/F1-ingest.md "Stato": schermata di
 * verifica). `model` is optional like the other generation jobs — falls
 * back to the routing default in the processor.
 */
export const TranscribeSchemaJobInputSchema = z.object({
  documentId: z.string().uuid(),
  model: z.string().optional(),
});
export type TranscribeSchemaJobInput = z.infer<typeof TranscribeSchemaJobInputSchema>;

/** Computes the local embedding for every chunk of a document missing one. */
export const EmbedChunksJobInputSchema = z.object({ documentId: z.string().uuid() });
export type EmbedChunksJobInput = z.infer<typeof EmbedChunksJobInputSchema>;

/** AI-suggested `documents.type`, enqueued right after upload — never overrides a user-picked type. */
export const ClassifyDocumentTypeJobInputSchema = z.object({
  documentId: z.string().uuid(),
  model: z.string().optional(),
});
export type ClassifyDocumentTypeJobInput = z.infer<typeof ClassifyDocumentTypeJobInputSchema>;

/** Distills recent `transcription_corrections` rows into handwriting-profile.md lines. */
export const DistillHandwritingProfileJobInputSchema = z.object({
  subjectSlug: z.string(),
  documentId: z.string().uuid(),
  model: z.string().optional(),
});
export type DistillHandwritingProfileJobInput = z.infer<
  typeof DistillHandwritingProfileJobInputSchema
>;

export const JobProgressSchema = z.object({
  pct: z.number().min(0).max(100),
  step: z.string(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type JobError = z.infer<typeof JobErrorSchema>;

/**
 * BullMQ queue name shared by the web enqueuer and the worker consumer.
 * No ':' — BullMQ rejects it (it's the Redis key separator). The original
 * 'studyhub:jobs' failed at `new Queue()` and went unnoticed until F5,
 * because no test built a real Queue; apps/worker/test/queue.test.ts now does.
 */
export const JOB_QUEUE_NAME = 'studyhub-jobs';
