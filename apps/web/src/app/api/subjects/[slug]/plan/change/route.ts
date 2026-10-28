import { NextResponse } from 'next/server';
import { resolveProvider } from '@studyhub/ai';
import { ProposePlanChangeRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { proposePlanChange } from '@/lib/planChange';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * "Modifica piano": la richiesta dello studente, a parole, diventa una proposta di nuovi parametri.
 * Non genera e non scrive nulla sul piano: la bozza parte solo quando lo studente conferma la proposta.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await parseBody(request, ProposePlanChangeRequestSchema);
  if (body.error) return body.error;
  try {
    const today = body.data.today ?? new Date().toISOString().slice(0, 10);
    return NextResponse.json(
      await proposePlanChange(getDb(), slug, body.data, resolveProvider(), today),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
