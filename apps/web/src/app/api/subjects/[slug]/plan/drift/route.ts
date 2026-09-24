import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPlanDrift } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** docs/04-planner.md: "al rientro il sistema propone un ricalcolo" — `null` when there's no active plan. */
export async function GET(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const today = new URL(request.url).searchParams.get('date') ?? todayIso();
  try {
    const drift = await getPlanDrift(getDb(), slug, today);
    return NextResponse.json({ drift });
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
