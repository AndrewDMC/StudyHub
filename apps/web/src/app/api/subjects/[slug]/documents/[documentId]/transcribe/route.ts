import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { requireDocument } from '@/lib/schemaBlocks';
import { DocumentNotFoundError } from '@/lib/documentTopics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; documentId: string }> };

/** (Re-)enqueues `transcribe_schema` — the "Ritrascrivi" action (docs/fasi/F1-ingest.md "Stato"). */
export async function POST(_request: Request, { params }: RouteParams) {
  const { slug, documentId } = await params;
  try {
    const document = await requireDocument(getDb(), slug, documentId);
    if (document.type !== 'schemi') {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_request',
            message: 'La trascrizione è disponibile solo per documenti di tipo "Schemi"',
          },
        },
        { status: 400 },
      );
    }

    const jobId = randomUUID();
    await getJobQueue().add('transcribe_schema', { documentId }, { jobId });
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof DocumentNotFoundError) {
      return NextResponse.json(
        { error: { code: 'document_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
