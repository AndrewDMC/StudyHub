import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { deleteExam, ExamNotFoundError } from '@/lib/exams';
import { formatError, SubjectNotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; examId: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { slug, examId } = await params;
  try {
    await deleteExam(getDb(), slug, examId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SubjectNotFoundError) {
      return NextResponse.json(
        { error: { code: 'subject_not_found', message: err.message } },
        { status: 404 },
      );
    }
    if (err instanceof ExamNotFoundError) {
      return NextResponse.json(
        { error: { code: 'exam_not_found', message: err.message } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
