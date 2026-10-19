import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getReviewOverview } from '@/lib/review';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Home of the Ripasso rapido (docs/09-ripasso-mobile.md §B2): due cards per subject and topic.
 * `?materia=<slug>` returns just that subject (`subjects` has one entry), archived or not, so a
 * subject page counts exactly what its own queue holds; 404 for an unknown slug.
 */
export async function GET(request: Request) {
  const materia = new URL(request.url).searchParams.get('materia') || undefined;
  try {
    const overview = await getReviewOverview(getDb(), new Date(), { subjectSlug: materia });
    return NextResponse.json(overview);
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
