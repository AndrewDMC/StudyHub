import { NextResponse } from 'next/server';
import { UpdateTaskRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { deleteDraftTask, TaskNotFoundError, updateDraftTask } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; taskId: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, taskId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = UpdateTaskRequestSchema.safeParse(body);
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
    const task = await updateDraftTask(getDb(), slug, taskId, parsed.data);
    return NextResponse.json({ task });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof TaskNotFoundError) {
      return NextResponse.json(
        { error: { code: 'task_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'invalid_request', message: formatError(err) } },
      { status: 409 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { slug, taskId } = await params;
  try {
    await deleteDraftTask(getDb(), slug, taskId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof TaskNotFoundError) {
      return NextResponse.json(
        { error: { code: 'task_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'invalid_request', message: formatError(err) } },
      { status: 409 },
    );
  }
}
