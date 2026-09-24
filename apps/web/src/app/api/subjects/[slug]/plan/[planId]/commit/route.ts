import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getDataRoot } from '@/lib/dataRoot';
import { commitPlan, PlanNotFoundError } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; planId: string }> };

/** docs/04-planner.md §9.3: single transaction, idempotent on `planId`. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { slug, planId } = await params;
  try {
    const plan = await commitPlan(getDb(), getDataRoot(), slug, planId);
    return NextResponse.json({ plan });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof PlanNotFoundError) {
      return NextResponse.json(
        { error: { code: 'plan_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
