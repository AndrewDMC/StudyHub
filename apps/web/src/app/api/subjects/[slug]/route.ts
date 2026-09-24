import { NextResponse } from 'next/server';
import { UpdateSubjectRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getDataRoot } from '@/lib/dataRoot';
import { deleteSubjectPermanently, getSubjectBySlug, setSubjectArchived } from '@/lib/subjects';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    const subject = await getSubjectBySlug(getDb(), slug);
    if (!subject) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: `Materia non trovata: ${slug}` } },
        { status: 404 },
      );
    }
    return NextResponse.json({ subject });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}

/** Archive/unarchive (soft, reversible — never touches the filesystem). */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  const parsed = UpdateSubjectRequestSchema.safeParse(body);
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
    const subject = await setSubjectArchived(getDb(), slug, parsed.data.archived);
    return NextResponse.json({ subject });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}

/** "Elimina definitivamente": moves the folder to /data/.trash/, drops the DB row. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    await deleteSubjectPermanently(getDb(), getDataRoot(), slug);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
