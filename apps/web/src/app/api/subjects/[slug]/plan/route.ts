import { NextResponse } from 'next/server';
import { GeneratePlanRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import {
  enqueueGeneratePlan,
  ExamNotFoundError,
  getCurrentPlan,
  InvalidScopeError,
} from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    const plan = await getCurrentPlan(getDb(), slug);
    return NextResponse.json({ plan });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  const parsed = GeneratePlanRequestSchema.safeParse(body);
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
    const result = await enqueueGeneratePlan(getDb(), getJobQueue(), slug, parsed.data);
    return NextResponse.json(result, { status: 202 });
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
    if (err instanceof ExamNotFoundError) {
      return NextResponse.json(
        { error: { code: 'exam_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
