import { NextResponse } from 'next/server';
import { UpdateTopicRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { deleteTopic, TopicNotFoundError, updateTopic } from '@/lib/topics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; topicId: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, topicId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = UpdateTopicRequestSchema.safeParse(body);
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
    const topic = await updateTopic(getDb(), slug, topicId, parsed.data);
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
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { slug, topicId } = await params;
  try {
    await deleteTopic(getDb(), slug, topicId);
    return new NextResponse(null, { status: 204 });
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
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
