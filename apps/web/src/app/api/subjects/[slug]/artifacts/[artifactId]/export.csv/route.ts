import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ArtifactNotFoundError, exportDeckCsv } from '@/lib/generation';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** Deck CSV export (docs/fasi/F4-flashcard.md scope), importable via Anki's own CSV importer. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; artifactId: string }> },
) {
  const { slug, artifactId } = await params;
  try {
    const { filename, csv } = await exportDeckCsv(getDb(), slug, artifactId);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
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
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
