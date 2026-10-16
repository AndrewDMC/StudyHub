import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { artifacts, attemptAnswerPhotos, subjects } from '@studyhub/db';
import {
  ATTEMPT_PHOTO_MAX_BYTES,
  assertRealpathWithinRoot,
  isAttemptPhotoMime,
  resolveSubjectPath,
  resolveSubjectSubpath,
} from '@studyhub/core';
import { estimateCostEur, resolveModel, type AiProvider } from '@studyhub/ai';

/** Handwriting (formulas, crossed-out lines) is where a weak reader costs the student points: not Haiku. */
const MODEL_ROUTING_ANSWER_PHOTO_OCR = 'claude-sonnet-5-5';
/** One transcription never grows the grading prompt past this, whatever the model returns. */
const MAX_TRANSCRIPTION_CHARS = 20_000;

type PhotoRow = typeof attemptAnswerPhotos.$inferSelect;
type TranscriptStatus = NonNullable<PhotoRow['transcriptStatus']>;

export const ANSWER_PHOTO_HEADING = '[Foto del foglio]';

export interface AnswerPhotoTranscriptions {
  /** itemId -> text to append to the typed answer (headed `[Foto del foglio]`), only for items that got some. */
  byItem: Map<string, string>;
  /** Human-readable, content-free notes for photos that could not be read (the grading went on without them). */
  warnings: string[];
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/** Slug of the subject a simulation (= its artifact) belongs to, or null if it can't be found. */
export async function findSimulationSubjectSlug(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  simulationId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ slug: subjects.slug })
    .from(artifacts)
    .innerJoin(subjects, eq(subjects.id, artifacts.subjectId))
    .where(eq(artifacts.id, simulationId));
  return row?.slug ?? null;
}

/** Typed answer first, then the photo transcription; nothing but the transcription when nothing was typed. */
export function composeAnswer(typed: string, photoText: string | undefined): string {
  if (!photoText) return typed;
  return typed.trim() ? `${typed}\n\n${photoText}` : photoText;
}

/**
 * Transcribes the photos attached to an attempt's answers (`attempt_answer_photos`) with the
 * provider's vision OCR, so the grader reads handwritten work as text. The result (text + status)
 * is stored on the photo row and reused by retries and the second opinion. A photo that is missing,
 * out of limits or unreadable only yields a warning — grading proceeds with the typed answer — while
 * a provider failure of any kind is rethrown (the job retries; nothing is graded or stored for that
 * photo). Nothing here logs or returns the photo's content apart from the transcription itself.
 */
export async function transcribeAnswerPhotos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  subjectSlug: string,
  attemptId: string,
  validItemIds: ReadonlySet<string>,
  provider: AiProvider,
): Promise<AnswerPhotoTranscriptions> {
  const out: AnswerPhotoTranscriptions = {
    byItem: new Map(),
    warnings: [],
    costEur: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  const rows: (typeof attemptAnswerPhotos.$inferSelect)[] = await db
    .select()
    .from(attemptAnswerPhotos)
    .where(eq(attemptAnswerPhotos.attemptId, attemptId))
    .orderBy(asc(attemptAnswerPhotos.createdAt), asc(attemptAnswerPhotos.id));
  const photos = rows.filter((r) => validItemIds.has(r.itemId));
  if (photos.length === 0) return out;

  const model = resolveModel(MODEL_ROUTING_ANSWER_PHOTO_OCR);
  const subjectRoot = resolveSubjectPath(subjectSlug, dataRoot);
  const textsByItem = new Map<string, string[]>();

  /**
   * One OCR pass over one photo. Local and content problems resolve to a status (`failed` before
   * any provider call: missing file, unsafe path, mime/size out of limits; `illegible` when the
   * OCR ran but read nothing). A provider exception is never turned into a status: it is rethrown
   * so the job retries instead of grading (and remembering) a transcription that never happened.
   */
  const readPhoto = async (
    photo: PhotoRow,
  ): Promise<{ status: TranscriptStatus; text: string }> => {
    const failed = { status: 'failed' as const, text: '' };
    if (!isAttemptPhotoMime(photo.mime) || photo.size > ATTEMPT_PHOTO_MAX_BYTES) return failed;

    let abs: string;
    try {
      abs = resolveSubjectSubpath(subjectSlug, photo.relPath.split('/'), dataRoot);
      await assertRealpathWithinRoot(dirname(abs), subjectRoot);
      await assertRealpathWithinRoot(abs, subjectRoot);
      const stat = await fs.stat(abs);
      if (!stat.isFile() || stat.size === 0 || stat.size > ATTEMPT_PHOTO_MAX_BYTES) return failed;
    } catch {
      return failed; // unsafe path, missing file, unreadable: nothing to send to the provider
    }

    // Any exception from the provider propagates, whatever its kind (429, 5xx, network, but also
    // 401/403 or an unauthenticated CLI): nothing is stored, the job retries, and fixing the key
    // is enough to get the real transcription. A status is only ever saved for local or content
    // causes (above, and below), never for "the provider didn't answer".
    const result = await provider.ocrText(
      { imagePath: abs, mime: photo.mime, purpose: 'answer_photo' },
      model,
    );
    // Known limit: if the grade later stops (budget, retry), this OCR cost is not carried over to
    // the retry, which reuses the stored transcript and so reports 0 for it.
    out.usage.inputTokens += result.usage.inputTokens;
    out.usage.outputTokens += result.usage.outputTokens;
    out.costEur += estimateCostEur(
      result.model,
      result.usage.inputTokens,
      result.usage.outputTokens,
    );

    const text = result.data.text.trim().slice(0, MAX_TRANSCRIPTION_CHARS);
    if (result.data.confidence === 'illegible' || !text) return { status: 'illegible', text: '' };
    return { status: 'ok', text };
  };

  const store = async (
    photo: PhotoRow,
    status: TranscriptStatus,
    transcript: string,
  ): Promise<void> => {
    await db
      .update(attemptAnswerPhotos)
      .set({ transcript, transcriptStatus: status, transcribedAt: new Date() })
      .where(eq(attemptAnswerPhotos.id, photo.id));
  };

  for (const photo of photos) {
    let status: TranscriptStatus;
    let text: string;

    if (photo.transcriptStatus) {
      // Already transcribed by an earlier run (a retry, or the first grade): never pay twice.
      status = photo.transcriptStatus;
      text = photo.transcript ?? '';
    } else {
      const read = await readPhoto(photo);
      status = read.status;
      text = read.text;
      await store(photo, status, text);
    }

    if (status === 'ok' && text) {
      const list = textsByItem.get(photo.itemId) ?? [];
      list.push(text);
      textsByItem.set(photo.itemId, list);
    } else {
      out.warnings.push(
        status === 'illegible'
          ? `Foto ${photo.id}: illeggibile, ignorata.`
          : `Foto ${photo.id}: non utilizzabile (file mancante, non valido o fuori limite), ignorata.`,
      );
    }
  }

  for (const [itemId, texts] of textsByItem) {
    out.byItem.set(
      itemId,
      texts.length === 1
        ? `${ANSWER_PHOTO_HEADING}\n${texts[0]}`
        : texts.map((t, i) => `[Foto del foglio ${i + 1}/${texts.length}]\n${t}`).join('\n\n'),
    );
  }
  return out;
}
