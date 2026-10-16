import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getDataRoot } from '@/lib/dataRoot';
import { getJobQueue } from '@/lib/queue';
import { deleteAttemptPhoto } from '@/lib/examPrep';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = {
  params: Promise<{ slug: string; attemptId: string; itemId: string; photoId: string }>;
};

/** Removes the photo (row and file); only while the attempt is open. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { slug, attemptId, itemId, photoId } = await params;
  try {
    await deleteAttemptPhoto(
      getDb(),
      getJobQueue(),
      getDataRoot(),
      slug,
      attemptId,
      itemId,
      photoId,
    );
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
