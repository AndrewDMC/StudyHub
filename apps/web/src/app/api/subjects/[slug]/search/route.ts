import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { searchSubject } from '@/lib/search';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const query = new URL(request.url).searchParams.get('q') ?? '';
  try {
    const results = await searchSubject(getDb(), slug, query);
    return NextResponse.json({ results });
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
