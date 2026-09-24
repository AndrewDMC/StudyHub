import { NextResponse } from 'next/server';
import type { z, ZodTypeAny } from 'zod';
import { formatError, SubjectNotFoundError } from './errors';
import { ConflictError, NotFoundError } from './examPrep';

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof SubjectNotFoundError) {
    return NextResponse.json(
      { error: { code: 'subject_not_found', message: err.message } },
      { status: 404 },
    );
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json(
      { error: { code: 'not_found', message: err.message } },
      { status: 404 },
    );
  }
  if (err instanceof ConflictError) {
    return NextResponse.json(
      { error: { code: 'conflict', message: err.message } },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: { code: 'internal_error', message: formatError(err) } },
    { status: 500 },
  );
}

/** Parses a JSON body against a schema (defaults applied); returns the data or a ready 400 response. */
export async function parseBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<{ data: z.output<S>; error?: undefined } | { data?: undefined; error: NextResponse }> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'invalid_request',
            message: parsed.error.issues[0]?.message ?? 'Richiesta non valida',
          },
        },
        { status: 400 },
      ),
    };
  }
  return { data: parsed.data };
}
