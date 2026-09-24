import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getReviewQueue } from '@/lib/review';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(request.url);
  const cap = url.searchParams.get('cap');
  const newLimit = url.searchParams.get('newLimit');
  const topicId = url.searchParams.get('topicId');

  try {
    const queue = await getReviewQueue(getDb(), slug, {
      cap: cap ? Number(cap) : undefined,
      newLimit: newLimit ? Number(newLimit) : undefined,
      topicId: topicId ?? undefined,
    });
    return NextResponse.json({ queue });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
