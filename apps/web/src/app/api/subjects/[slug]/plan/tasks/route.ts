import { NextResponse } from 'next/server';
import { CreateManualTaskRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { createManualTask, NoDraftPlanError } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/** docs/04-planner.md §9.2: "aggiungi una task manuale — non tutto nasce dall'AI". */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  const parsed = CreateManualTaskRequestSchema.safeParse(body);
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
    const task = await createManualTask(getDb(), slug, parsed.data);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof NoDraftPlanError) {
      return NextResponse.json(
        { error: { code: 'no_draft_plan', message: err.message } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
