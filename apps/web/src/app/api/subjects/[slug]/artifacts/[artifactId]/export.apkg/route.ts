import { getDb } from '@/lib/db';
import { exportDeckApkg } from '@/lib/deckExchange';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';
// `node:sqlite` and temp files: Node runtime only.
export const runtime = 'nodejs';

/** Deck `.apkg` export (docs/fasi/F4-flashcard.md): importable in Anki, FSRS state included. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; artifactId: string }> },
) {
  const { slug, artifactId } = await params;
  try {
    const { filename, bytes } = await exportDeckApkg(getDb(), slug, artifactId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/apkg',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
