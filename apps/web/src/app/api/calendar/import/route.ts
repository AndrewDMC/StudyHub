import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { importIcsCalendar } from '@/lib/calendar';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const MAX_ICS_BYTES = 5 * 1024 * 1024;

/** "Import ICS" (docs/fasi/F6-planner-calendario.md "Non implementato"): body is the raw .ics file (`text/calendar`). */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length === 0) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'File .ics vuoto' } },
      { status: 400 },
    );
  }
  if (raw.length > MAX_ICS_BYTES) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'File .ics troppo grande (limite 5MB)' } },
      { status: 400 },
    );
  }
  if (!raw.includes('BEGIN:VCALENDAR')) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Non è un file .ics valido (manca BEGIN:VCALENDAR)' } },
      { status: 400 },
    );
  }

  try {
    const result = await importIcsCalendar(getDb(), raw);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
