import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readModelPreference, SELECTABLE_MODELS, writeModelPreference } from '@studyhub/ai';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  /** `null` = automatic: every function keeps its own default model. */
  model: z.union([z.null(), z.enum(SELECTABLE_MODELS.map((m) => m.id) as [string, ...string[]])]),
});

function snapshot() {
  return { model: readModelPreference(), options: SELECTABLE_MODELS };
}

/** The global AI model: forces one model for every function that does not name its own. */
export async function GET() {
  return NextResponse.json(snapshot());
}

export async function PUT(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Modello non valido' } },
      { status: 400 },
    );
  }
  try {
    writeModelPreference(parsed.data.model);
    return NextResponse.json(snapshot());
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
