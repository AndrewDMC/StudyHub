import { NextResponse } from 'next/server';
import { ResolveDocumentTypeRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { deleteDocument, getDocument, resolveDocumentType } from '@/lib/documents';
import { getDataRoot } from '@/lib/dataRoot';
import { errorResponse } from '@/lib/http';
import { DocumentNotFoundError } from '@/lib/documentTopics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; documentId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, documentId } = await params;
  try {
    const document = await getDocument(getDb(), slug, documentId);
    return NextResponse.json({ document });
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

/** Applies or dismisses `typeSuggested` (the AI's pre-classification guess) — one click, never automatic. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, documentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = ResolveDocumentTypeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: { code: 'invalid_request', message: 'Corpo non valido: atteso { accept: boolean }' },
      },
      { status: 400 },
    );
  }
  try {
    const document = await resolveDocumentType(getDb(), slug, documentId, parsed.data.accept);
    return NextResponse.json({ document });
  } catch (err) {
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

/** Moves the document's files to `.trash/` and removes it from the subject (see `deleteDocument`). */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { slug, documentId } = await params;
  try {
    const result = await deleteDocument(getDb(), getDataRoot(), slug, documentId);
    return NextResponse.json(result);
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
