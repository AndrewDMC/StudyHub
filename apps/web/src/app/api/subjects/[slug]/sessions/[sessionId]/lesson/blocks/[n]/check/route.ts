import { NextResponse } from 'next/server';
import { resolveProvider } from '@studyhub/ai';
import { CheckLessonBlockRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { errorResponse, parseBody } from '@/lib/http';
import { InvalidRequestError } from '@/lib/examPrep';
import { checkLessonBlock } from '@/lib/lesson';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; sessionId: string; n: string }> };

/**
 * «Prima di andare avanti»: la risposta a una frase al controllo del blocco `n`. Correzione diretta
 * (una chiamata breve, come «Correggi con l'AI»); qualsiasi esito apre il blocco successivo.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, sessionId, n } = await params;
  const blockIndex = Number(n);
  if (!Number.isInteger(blockIndex) || blockIndex < 0) {
    return errorResponse(new InvalidRequestError('Blocco non valido'));
  }
  const body = await parseBody(request, CheckLessonBlockRequestSchema);
  if (body.error) return body.error;
  try {
    const result = await checkLessonBlock(
      getDb(),
      resolveProvider(),
      getJobQueue(),
      slug,
      sessionId,
      blockIndex,
      body.data,
    );
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
