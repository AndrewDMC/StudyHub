import { NextResponse } from 'next/server';
import { CreateFlashcardRequestSchema, ListFlashcardsQuerySchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { createFlashcard } from '@/lib/deckEditor';
import { errorResponse, parseBody } from '@/lib/http';
import { listFlashcards } from '@/lib/review';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(request.url);
  const suspendedParam = url.searchParams.get('suspended');
  const flaggedParam = url.searchParams.get('flagged');
  const limitParam = url.searchParams.get('limit');

  const parsed = ListFlashcardsQuerySchema.safeParse({
    topicId: url.searchParams.get('topicId') ?? undefined,
    state: url.searchParams.get('state') ?? undefined,
    suspended: suspendedParam === null ? undefined : suspendedParam === 'true',
    flagged: flaggedParam === null ? undefined : flaggedParam === 'true',
    deckId: url.searchParams.get('deckId') ?? undefined,
    tag: url.searchParams.get('tag') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: limitParam ? Number(limitParam) : undefined,
  });
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
    const page = await listFlashcards(getDb(), slug, parsed.data);
    return NextResponse.json({ page });
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

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data, error } = await parseBody(request, CreateFlashcardRequestSchema);
  if (error) return error;
  try {
    return NextResponse.json(
      { flashcard: await createFlashcard(getDb(), slug, data) },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
