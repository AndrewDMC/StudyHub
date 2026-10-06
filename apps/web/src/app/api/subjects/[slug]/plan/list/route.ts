import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listPlans } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/** The draft under review plus every active plan (one per exam or partial, and the general one). */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    const plans = await listPlans(getDb(), slug);
    return NextResponse.json({ plans });
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
