import { NextResponse } from 'next/server';
import { ReorderSubjectsRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { reorderSubjects } from '@/lib/subjects';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** Reassigns display order in the Materie grid (docs/fasi/F2-materie.md "riordina"). */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = ReorderSubjectsRequestSchema.safeParse(body);
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
    await reorderSubjects(getDb(), parsed.data.slugs);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: formatError(err) } },
      { status: 400 },
    );
  }
}
