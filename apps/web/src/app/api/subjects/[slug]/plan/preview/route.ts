import { NextResponse } from 'next/server';
import { GeneratePlanRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getPlanPreview, InvalidScopeError } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/** Free pre-flight for the wizard: feasibility + weekly load, no AI call, nothing written. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const parsed = GeneratePlanRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Richiesta non valida',
        },
      },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({ preview: await getPlanPreview(getDb(), slug, parsed.data) });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof InvalidScopeError) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: err.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
