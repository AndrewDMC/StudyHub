import { NextResponse } from 'next/server';
import { UpdateSchemaBlockRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { SchemaBlockNotFoundError, updateSchemaBlock } from '@/lib/schemaBlocks';
import { DocumentNotFoundError } from '@/lib/documentTopics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; documentId: string; blockId: string }> };

/** Edits a transcribed block — text, confidence, or `verified` (docs/fasi/F1-ingest.md "Stato"). */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, documentId, blockId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = UpdateSchemaBlockRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Richiesta non valida',
        },
      },
      { status: 400 },
    );
  }

  try {
    const block = await updateSchemaBlock(getDb(), slug, documentId, blockId, parsed.data);
    return NextResponse.json({ block });
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
    if (err instanceof SchemaBlockNotFoundError) {
      return NextResponse.json(
        { error: { code: 'block_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
