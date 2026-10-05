import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getDocumentDeletionImpact } from '@/lib/documents';
import { DocumentNotFoundError } from '@/lib/documentTopics';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; documentId: string }> };

/** What deleting this document would touch — read before showing the confirm dialog. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, documentId } = await params;
  try {
    const impact = await getDocumentDeletionImpact(getDb(), slug, documentId);
    return NextResponse.json({ impact });
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return NextResponse.json(
        { error: { code: 'document_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return errorResponse(err);
  }
}
