import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { exams, subjects, type Exam } from '@studyhub/db';
import type { CreateExamRequest, ExamDto } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export class ExamNotFoundError extends Error {
  constructor(id: string) {
    super(`Esame non trovato: ${id}`);
    this.name = 'ExamNotFoundError';
  }
}

function toDto(row: Exam): ExamDto {
  return {
    id: row.id,
    subjectId: row.subjectId,
    title: row.title,
    kind: row.kind,
    date: row.date.toISOString(),
    weight: row.weight,
    description: row.description,
    location: row.location,
    status: row.status,
    allowedMaterials: row.allowedMaterials,
    durationMin: row.durationMin,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

export async function listExams(db: AnyDb, subjectSlug: string): Promise<ExamDto[]> {
  const subject = await requireSubject(db, subjectSlug);
  const rows: Exam[] = await db
    .select()
    .from(exams)
    .where(eq(exams.subjectId, subject.id))
    .orderBy(exams.date);
  return rows.map(toDto);
}

export async function createExam(
  db: AnyDb,
  subjectSlug: string,
  input: CreateExamRequest,
): Promise<ExamDto> {
  const subject = await requireSubject(db, subjectSlug);
  const [row] = await db
    .insert(exams)
    .values({
      id: randomUUID(),
      subjectId: subject.id,
      title: input.title,
      kind: input.kind,
      date: new Date(input.date),
      weight: input.weight ?? null,
      description: input.description ?? null,
      location: input.location ?? null,
      allowedMaterials: input.allowedMaterials ?? null,
      durationMin: input.durationMin ?? null,
    })
    .returning();
  return toDto(row);
}

export async function deleteExam(db: AnyDb, subjectSlug: string, examId: string): Promise<void> {
  const subject = await requireSubject(db, subjectSlug);
  const deleted = await db
    .delete(exams)
    .where(and(eq(exams.id, examId), eq(exams.subjectId, subject.id)))
    .returning();
  if (deleted.length === 0) throw new ExamNotFoundError(examId);
}
