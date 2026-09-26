import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSchemaGraph } from '@/lib/schemaGraph';
import { DocumentNotFoundError } from '@/lib/documentTopics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; documentId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, documentId } = await params;
  try {
    const graph = await getSchemaGraph(getDb(), slug, documentId);
    return NextResponse.json(graph);
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
