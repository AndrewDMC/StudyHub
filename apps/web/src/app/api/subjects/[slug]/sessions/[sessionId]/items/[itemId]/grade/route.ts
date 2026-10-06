import { NextResponse } from 'next/server';
import { resolveProvider } from '@studyhub/ai';
import { GradeSessionItemRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { gradeSessionItem } from '@/lib/sessionBriefing';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string; itemId: string }> };

/**
 * "Correggi con l'AI": una chiamata breve, quindi diretta (come la chat) e non in coda.
 * Costa: è la via a pagamento accanto a «Mostra la soluzione» (docs/08, decisione 1).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId, itemId } = await params;
  const body = await parseBody(request, GradeSessionItemRequestSchema);
  if (body.error) return body.error;
  try {
    const item = await gradeSessionItem(
      getDb(),
      resolveProvider(),
      slug,
      sessionId,
      itemId,
      body.data,
    );
    return NextResponse.json({ item });
  } catch (err) {
    return errorResponse(err);
  }
}
