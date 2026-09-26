import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { enqueueSecondOpinion } from '@/lib/examPrep';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; attemptId: string; itemId: string }> };

/** "Seconda opinione" (docs/fasi/F5-esami-simulazioni.md "Rischi"): re-grades one item with a stronger model. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { slug, attemptId, itemId } = await params;
  try {
    const result = await enqueueSecondOpinion(getDb(), getJobQueue(), slug, attemptId, itemId);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
