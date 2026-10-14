import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getReviewOverview } from '@/lib/review';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** Home of the Ripasso rapido (docs/09-ripasso-mobile.md §B2): due cards per subject and topic. */
export async function GET() {
  try {
    const overview = await getReviewOverview(getDb());
    return NextResponse.json(overview);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
