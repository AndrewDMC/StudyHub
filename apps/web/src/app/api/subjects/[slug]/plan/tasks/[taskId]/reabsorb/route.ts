import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { MoveRefusedError, PlanNotFoundError, reabsorbTaskInPlan, TaskNotFoundError } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; taskId: string }> };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "Debito" — riassorbi nel piano (docs/fasi/F6-planner-calendario.md "Decisioni"): the algorithm picks the next day with room, not the user. */
export async function POST(_request: Request, { params }: RouteParams) {
  const { slug, taskId } = await params;
  try {
    const plan = await reabsorbTaskInPlan(getDb(), slug, taskId, todayIso());
    return NextResponse.json({ plan });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof TaskNotFoundError || err instanceof PlanNotFoundError) {
      return NextResponse.json(
        { error: { code: 'not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof MoveRefusedError) {
      return NextResponse.json(
        { error: { code: 'move_refused', message: err.message } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
