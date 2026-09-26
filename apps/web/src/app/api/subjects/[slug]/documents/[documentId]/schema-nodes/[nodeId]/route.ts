import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { UpdateSchemaNodeRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { updateSchemaNode, SchemaNodeNotFoundError } from '@/lib/schemaGraph';
import { DocumentNotFoundError } from '@/lib/documentTopics';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; documentId: string; nodeId: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug, documentId, nodeId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = UpdateSchemaNodeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Corpo non valido' } },
      { status: 400 },
    );
  }
  try {
    const node = await updateSchemaNode(getDb(), slug, documentId, nodeId, parsed.data);
    if (parsed.data.label !== undefined) {
      // Fire-and-forget: distills whatever corrections exist so far into the
      // handwriting profile. Best-effort, never blocks the save.
      await getJobQueue()
        .add(
          'distill_handwriting_profile',
          { subjectSlug: slug, documentId },
          { jobId: randomUUID() },
        )
        .catch(() => {});
    }
    return NextResponse.json({ node });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof DocumentNotFoundError) {
      return NextResponse.json(
        { error: { code: 'document_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof SchemaNodeNotFoundError) {
      return NextResponse.json(
        { error: { code: 'node_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
