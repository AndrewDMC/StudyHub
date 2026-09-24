import { NextResponse } from 'next/server';
import { SetDocumentTopicsRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import {
  DocumentNotFoundError,
  setDocumentTopics,
  TopicsNotFoundError,
} from '@/lib/documentTopics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; documentId: string }> };

/** Replaces the topics a document is tagged with (docs/fasi/F2-materie.md "Stato": document_topics). */
export async function PUT(request: Request, { params }: RouteParams) {
  const { slug, documentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SetDocumentTopicsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Richiesta non valida',
        },
      },
      { status: 400 },
    );
  }

  try {
    const topicIds = await setDocumentTopics(getDb(), slug, documentId, parsed.data.topicIds);
    return NextResponse.json({ topicIds });
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
    if (err instanceof TopicsNotFoundError) {
      return NextResponse.json(
        { error: { code: 'topics_not_found', message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
