import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getDataRoot } from '@/lib/dataRoot';
import { getJobQueue } from '@/lib/queue';
import { addAttemptPhoto, listAttemptPhotos } from '@/lib/examPrep';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; attemptId: string; itemId: string }> };

/** Photos attached to one exercise of an attempt. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, attemptId, itemId } = await params;
  try {
    return NextResponse.json({ photos: await listAttemptPhotos(getDb(), slug, attemptId, itemId) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Multipart upload, field `file` (jpeg/png/webp, max 5 MB, max 4 per exercise, open attempt only). */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, attemptId, itemId } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Campo "file" mancante' } },
      { status: 400 },
    );
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const photo = await addAttemptPhoto(
      getDb(),
      getJobQueue(),
      getDataRoot(),
      slug,
      attemptId,
      itemId,
      bytes,
    );
    return NextResponse.json({ photo }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
