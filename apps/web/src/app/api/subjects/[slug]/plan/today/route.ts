import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getDailyTasks } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Daily Task widget (docs/fasi/F7-dashboard-polish.md "Oggi"). */
export async function GET(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const date = new URL(request.url).searchParams.get('date') ?? todayIso();
  try {
    const tasks = await getDailyTasks(getDb(), slug, date);
    return NextResponse.json({ tasks });
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
