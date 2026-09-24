import { NextResponse } from 'next/server';
import { CreateSubjectRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getDataRoot } from '@/lib/dataRoot';
import { createSubject, listSubjectSummaries } from '@/lib/subjects';
import { formatError } from '@/lib/errors';

// Always reads live DB/FS state; never statically rendered or cached.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1';
    const subjects = await listSubjectSummaries(getDb(), { includeArchived });
    return NextResponse.json({ subjects });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = CreateSubjectRequestSchema.safeParse(body);
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
    const subject = await createSubject(getDb(), getDataRoot(), parsed.data);
    return NextResponse.json({ subject }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
