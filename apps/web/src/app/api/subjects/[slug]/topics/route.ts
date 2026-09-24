import { NextResponse } from 'next/server';
import { CreateTopicRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { createTopic, listTopics } from '@/lib/topics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';
import { TopicNotFoundError } from '@/lib/topics';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    const topics = await listTopics(getDb(), slug);
    return NextResponse.json({ topics });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  const parsed = CreateTopicRequestSchema.safeParse(body);
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
    const topic = await createTopic(getDb(), slug, parsed.data);
    return NextResponse.json({ topic }, { status: 201 });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof TopicNotFoundError) {
      return NextResponse.json(
        { error: { code: 'parent_not_found', message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
