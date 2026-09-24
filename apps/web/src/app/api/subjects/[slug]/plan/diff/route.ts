import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getPlanDiff } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/** docs/04-planner.md §9.5: the recalculation diff between the active plan and the current draft. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    const diff = await getPlanDiff(getDb(), slug);
    return NextResponse.json({ diff });
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
