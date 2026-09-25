import { NextResponse } from 'next/server';
import { AdminJobsQuerySchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { listAdminJobs } from '@/lib/admin';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** `/admin`: elenco job paginato, filtrabile per stato (docs/fasi/F7-dashboard-polish.md scope "log"). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = AdminJobsQuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
    offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Richiesta non valida',
        },
      },
      { status: 400 },
    );
  }

  try {
    const result = await listAdminJobs(getDb(), parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
