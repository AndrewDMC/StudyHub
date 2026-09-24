import { NextResponse } from 'next/server';
import { MergeTopicsRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { mergeTopics, TopicNotFoundError } from '@/lib/topics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; topicId: string }> };

/** Merges the topic in the URL into `intoTopicId` and deletes it (docs/fasi/F2-materie.md). */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, topicId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = MergeTopicsRequestSchema.safeParse(body);
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
    const topic = await mergeTopics(getDb(), slug, topicId, parsed.data.intoTopicId);
    return NextResponse.json({ topic });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof TopicNotFoundError) {
      return NextResponse.json(
        { error: { code: 'topic_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof Error && err.message.includes('sé stesso')) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
