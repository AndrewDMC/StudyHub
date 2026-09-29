import { NextResponse } from 'next/server';
import { MergeDecksRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { mergeDecks } from '@/lib/deckEditor';
import { errorResponse, parseBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Moves every card of the source deck into the target deck, then removes the source deck. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data, error } = await parseBody(request, MergeDecksRequestSchema);
  if (error) return error;
  try {
    return NextResponse.json(await mergeDecks(getDb(), slug, data.sourceDeckId, data.targetDeckId));
  } catch (err) {
    return errorResponse(err);
  }
}
