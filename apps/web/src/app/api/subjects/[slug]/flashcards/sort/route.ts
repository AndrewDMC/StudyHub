import { NextResponse } from 'next/server';
import { SortFlashcardsJobInputSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { errorResponse } from '@/lib/http';
import { enqueueSortFlashcards } from '@/lib/flashcardGroups';

export const dynamic = 'force-dynamic';

const RequestSchema = SortFlashcardsJobInputSchema.omit({ subjectId: true });

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Body is optional: an empty POST sorts every unsorted card of the subject.
  const body = await request.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body ?? {});
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
    const result = await enqueueSortFlashcards(getDb(), getJobQueue(), slug, parsed.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
