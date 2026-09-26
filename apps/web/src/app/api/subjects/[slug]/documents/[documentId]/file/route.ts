import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireDocument } from '@/lib/schemaBlocks';
import { DocumentNotFoundError } from '@/lib/documentTopics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; documentId: string }> };

/** Streams the original uploaded bytes — used by the verification screen's `<img>`. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, documentId } = await params;
  try {
    const document = await requireDocument(getDb(), slug, documentId);
    const bytes = await readFile(document.storedPath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': document.mime,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof DocumentNotFoundError) {
      return NextResponse.json(
        { error: { code: 'document_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
