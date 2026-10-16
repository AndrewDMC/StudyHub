import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { errorResponse } from '@/lib/http';
import { getSortJobStatus } from '@/lib/flashcardGroups';

export const dynamic = 'force-dynamic';

/** Status of a `sort_flashcards` job (same shape as topics/extract/[jobId]). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; jobId: string }> },
) {
  const { slug, jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'jobId non valido' } },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await getSortJobStatus(getDb(), slug, jobId));
  } catch (err) {
    return errorResponse(err);
  }
}
