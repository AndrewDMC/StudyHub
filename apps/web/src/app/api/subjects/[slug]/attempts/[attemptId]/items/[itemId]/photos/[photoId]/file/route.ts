import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getDataRoot } from '@/lib/dataRoot';
import { readAttemptPhotoFile } from '@/lib/examPrep';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = {
  params: Promise<{ slug: string; attemptId: string; itemId: string; photoId: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, attemptId, itemId, photoId } = await params;
  try {
    const { bytes, mime } = await readAttemptPhotoFile(
      getDb(),
      getDataRoot(),
      slug,
      attemptId,
      itemId,
      photoId,
    );
    return new NextResponse(new Blob([bytes as BlobPart]), {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
