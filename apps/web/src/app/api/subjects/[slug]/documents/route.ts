import { NextResponse } from 'next/server';
import { isDocumentType } from '@studyhub/core';
import { getDb } from '@/lib/db';
import { getDataRoot } from '@/lib/dataRoot';
import { getJobQueue } from '@/lib/queue';
import { listDocuments, uploadDocument, UploadError } from '@/lib/documents';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

function errorStatus(code: UploadError['code']): number {
  switch (code) {
    case 'subject_not_found':
      return 404;
    case 'file_too_large':
      return 413;
    default:
      return 400;
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    const documents = await listDocuments(getDb(), slug);
    return NextResponse.json({ documents });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: errorStatus(err.code) },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const type = form?.get('type');

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Campo "file" mancante' } },
      { status: 400 },
    );
  }
  if (typeof type !== 'string' || !isDocumentType(type)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Campo "type" mancante o non valido' } },
      { status: 400 },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadDocument(getDb(), getDataRoot(), slug, {
      type,
      originalName: file.name,
      bytes,
    });

    if (!result.duplicate) {
      // Fire-and-forget: upload succeeds even if the queue enqueue fails —
      // a later `reconcile`/manual retry can pick it up. Never blocks the
      // response on Redis being up.
      await getJobQueue()
        .add('extract_text', { documentId: result.document.id })
        .catch(() => {});
    }

    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: errorStatus(err.code) },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
