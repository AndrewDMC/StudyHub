import { NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/queue';
import { enqueueReconcile } from '@/lib/admin';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** `/admin` "reset indice": re-runs a full-data-root `reconcile` (docs/fasi/F7-dashboard-polish.md scope). */
export async function POST() {
  try {
    const result = await enqueueReconcile(getJobQueue());
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
