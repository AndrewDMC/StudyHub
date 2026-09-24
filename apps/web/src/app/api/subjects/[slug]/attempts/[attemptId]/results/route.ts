import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAttemptResults } from '@/lib/examPrep';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; attemptId: string }> },
) {
  const { slug, attemptId } = await params;
  try {
    return NextResponse.json({ results: await getAttemptResults(getDb(), slug, attemptId) });
  } catch (err) {
    return errorResponse(err);
  }
}
