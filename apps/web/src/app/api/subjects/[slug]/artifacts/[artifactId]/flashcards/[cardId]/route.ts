import { NextResponse } from 'next/server';
import { ReviewFlashcardRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { ArtifactNotFoundError, FlashcardNotFoundError, reviewFlashcard } from '@/lib/generation';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; artifactId: string; cardId: string }> };

/** Review queue action (docs/fasi/F3-ai-core.md): approve/edit keeps the card, discard removes it. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, artifactId, cardId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = ReviewFlashcardRequestSchema.safeParse(body);
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
    const flashcard = await reviewFlashcard(getDb(), slug, artifactId, cardId, parsed.data);
    return NextResponse.json({ flashcard });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof ArtifactNotFoundError) {
      return NextResponse.json(
        { error: { code: 'artifact_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof FlashcardNotFoundError) {
      return NextResponse.json(
        { error: { code: 'flashcard_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
