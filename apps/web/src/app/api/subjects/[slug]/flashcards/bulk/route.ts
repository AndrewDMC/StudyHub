import { NextResponse } from 'next/server';
import { BulkFlashcardsRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { bulkFlashcards } from '@/lib/deckEditor';
import { errorResponse, parseBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** One action (delete/suspend/move/topic/tag) applied to a selection of cards. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data, error } = await parseBody(request, BulkFlashcardsRequestSchema);
  if (error) return error;
  try {
    return NextResponse.json(await bulkFlashcards(getDb(), slug, data));
  } catch (err) {
    return errorResponse(err);
  }
}
