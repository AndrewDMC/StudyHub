import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCalendarRange } from '@/lib/calendar';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Cross-subject calendar (docs/fasi/F6-planner-calendario.md "Scope"): `?start=YYYY-MM-DD&end=YYYY-MM-DD`, end exclusive. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start') ?? '';
  const end = url.searchParams.get('end') ?? '';
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || start >= end) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: 'start/end mancanti o non validi (attesi YYYY-MM-DD, start < end)',
        },
      },
      { status: 400 },
    );
  }

  try {
    const range = await getCalendarRange(getDb(), start, end);
    return NextResponse.json(range);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
