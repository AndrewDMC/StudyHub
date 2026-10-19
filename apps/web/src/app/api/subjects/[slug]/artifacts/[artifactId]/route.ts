import { NextResponse } from 'next/server';
import { UpdateArtifactRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { updateDeck } from '@/lib/deckEditor';
import { errorResponse, parseBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; artifactId: string }> },
) {
  const { slug, artifactId } = await params;
  const { data, error } = await parseBody(request, UpdateArtifactRequestSchema);
  if (error) return error;
  try {
    return NextResponse.json({ artifact: await updateDeck(getDb(), slug, artifactId, data) });
  } catch (err) {
    return errorResponse(err);
  }
}
