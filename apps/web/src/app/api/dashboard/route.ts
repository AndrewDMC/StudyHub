import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getDashboardSummary } from '@/lib/dashboard';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Dashboard home (docs/fasi/F7-dashboard-polish.md "Scope — Dashboard"). */
export async function GET() {
  try {
    const summary = await getDashboardSummary(getDb(), todayIso());
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
