import { NextResponse } from 'next/server';
import { EstimateBriefingRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { estimateBriefing } from '@/lib/sessionBriefing';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string }> };

/** Costo stimato prima di lanciare il job (docs/03-ai-e-worker.md §4). */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId } = await params;
  const body = await parseBody(request, EstimateBriefingRequestSchema);
  if (body.error) return body.error;
  try {
    return NextResponse.json(await estimateBriefing(getDb(), slug, sessionId, body.data));
  } catch (err) {
    return errorResponse(err);
  }
}
