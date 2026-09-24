import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { approveDeck, ArtifactNotFoundError } from '@/lib/generation';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string; artifactId: string }> },
) {
  const { slug, artifactId } = await params;
  try {
    const artifact = await approveDeck(getDb(), slug, artifactId);
    return NextResponse.json({ artifact });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof ArtifactNotFoundError) {
      return NextResponse.json(
        { error: { code: 'artifact_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
