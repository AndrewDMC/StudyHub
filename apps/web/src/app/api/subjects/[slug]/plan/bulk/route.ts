import { NextResponse } from 'next/server';
import { BulkPlanActionRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import {
  applyBulk,
  MoveRefusedError,
  NoDraftPlanError,
  PlanNotFoundError,
  PlanRequestError,
} from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/** Bulk edit of the draft under review — refused whole (409) if it would break a hard constraint. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const parsed = BulkPlanActionRequestSchema.safeParse(await request.json().catch(() => null));
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
    const { plan, skipped } = await applyBulk(getDb(), slug, parsed.data);
    return NextResponse.json({ plan, skipped });
  } catch (err) {
    if (err instanceof PlanRequestError) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: err.message } },
        { status: 400 },
      );
    }
    if (
      err instanceof SubjectNotFoundError ||
      err instanceof NoDraftPlanError ||
      err instanceof PlanNotFoundError
    ) {
      return NextResponse.json(
        { error: { code: 'not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof MoveRefusedError) {
      return NextResponse.json(
        { error: { code: 'bulk_refused', message: err.message } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
