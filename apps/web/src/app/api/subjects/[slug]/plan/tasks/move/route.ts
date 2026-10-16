import { NextResponse } from 'next/server';
import { MoveTasksRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import {
  MoveRefusedError,
  moveTasksInPlan,
  PlanNotFoundError,
  PlanRequestError,
  TaskNotFoundError,
} from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/** "Sposta di N giorni" on a group of open tasks of one active plan: one transaction, refused whole (409). */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const parsed = MoveTasksRequestSchema.safeParse(await request.json().catch(() => null));
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
    const plan = await moveTasksInPlan(getDb(), slug, parsed.data.taskIds, parsed.data.days);
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
    if (err instanceof PlanRequestError) {
      return NextResponse.json(
        { error: { code: 'invalid_request', message: err.message } },
        { status: 400 },
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
