import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { importDeckFile, ImportFileError } from '@/lib/deckExchange';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 50 MB: generous for a deck of text cards, small enough that a wrong file fails fast. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const invalid = (message: string, status = 400) =>
  NextResponse.json({ error: { code: 'invalid_file', message } }, { status });

/**
 * Imports a `.apkg` or `.csv` (multipart: `file`, optional `deckId` to add into an existing deck,
 * optional `title` for a new one) — docs/fasi/F4-flashcard.md "Export/import Anki .apkg e CSV".
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return invalid('Nessun file caricato');
  if (file.size > MAX_UPLOAD_BYTES) return invalid('File troppo grande (massimo 50 MB)', 413);

  const deckId = form?.get('deckId');
  const title = form?.get('title');
  try {
    const result = await importDeckFile(
      getDb(),
      slug,
      { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
      {
        deckId: typeof deckId === 'string' && deckId ? deckId : undefined,
        title: typeof title === 'string' ? title : undefined,
      },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ImportFileError) return invalid(err.message);
    return errorResponse(err);
  }
}
