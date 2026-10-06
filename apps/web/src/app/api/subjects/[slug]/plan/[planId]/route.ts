import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getDataRoot } from '@/lib/dataRoot';
import { deletePlan, PlanNotFoundError } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; planId: string }> };

/** Deletes the plan and all its tasks, whatever its status (draft, active or superseded). */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { slug, planId } = await params;
  try {
    await deletePlan(getDb(), getDataRoot(), slug, planId);
    return new NextResponse(null, { status: 204 });
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
