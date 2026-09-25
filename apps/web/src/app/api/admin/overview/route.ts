import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAdminOverview } from '@/lib/admin';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** `/admin`: costi per mese + stato ultimo sync FS (docs/fasi/F7-dashboard-polish.md scope). */
export async function GET() {
  try {
    const overview = await getAdminOverview(getDb());
    return NextResponse.json(overview);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
