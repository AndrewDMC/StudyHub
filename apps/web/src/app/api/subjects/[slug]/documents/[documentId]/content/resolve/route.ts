import { NextResponse } from 'next/server';
import { ResolveDocumentContentConflictRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getDataRoot } from '@/lib/dataRoot';
import { resolveDocumentContentConflict, NoCanonicalMarkdownError } from '@/lib/documentContent';
import { DocumentNotFoundError } from '@/lib/documentTopics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; documentId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const { slug, documentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = ResolveDocumentContentConflictRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: "Corpo non valido: atteso { keep: 'mine'|'new' }",
        },
      },
      { status: 400 },
    );
  }
  try {
    await resolveDocumentContentConflict(
      getDb(),
      getDataRoot(),
      slug,
      documentId,
      parsed.data.keep,
    );
    return NextResponse.json({ ok: true });
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
    if (err instanceof NoCanonicalMarkdownError) {
      return NextResponse.json(
        { error: { code: 'no_content', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
