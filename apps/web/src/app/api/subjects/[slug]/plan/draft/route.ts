import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { discardDraft } from '@/lib/plan';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/** docs/04-planner.md §9.6: "rifiuto il diff, il piano attivo resta identico" — discards the draft without committing. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    await discardDraft(getDb(), slug);
    return new NextResponse(null, { status: 204 });
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
