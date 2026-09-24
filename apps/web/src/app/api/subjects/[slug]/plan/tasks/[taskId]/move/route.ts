import { NextResponse } from 'next/server';
import { MoveTaskRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { MoveRefusedError, moveTaskInPlan, PlanNotFoundError, TaskNotFoundError } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; taskId: string }> };

/** Calendar drag&drop (docs/fasi/F6-planner-calendario.md): instant, no AI call. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug, taskId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = MoveTaskRequestSchema.safeParse(body);
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
    const plan = await moveTaskInPlan(getDb(), slug, taskId, parsed.data.date);
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
