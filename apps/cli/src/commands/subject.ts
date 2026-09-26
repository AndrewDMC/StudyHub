import { subjects, type Database } from '@studyhub/db';
import type { SubjectColor } from '@studyhub/core';
import { createSubjectRow, type SubjectRow } from '@studyhub/services';

export interface AddSubjectInput {
  name: string;
  color: SubjectColor;
  professor?: string | undefined;
  cfu?: number | undefined;
}

export type { SubjectRow };

/**
 * Same create-subject flow as apps/web/src/lib/subjects.ts (FS first, then
 * DB index) exposed as a CLI command — "apps/cli è lo stesso codice del
 * worker invocato one-shot" (docs/01-architettura.md §1). Shared logic lives
 * in @studyhub/services.
 */
export async function addSubject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  dataRoot: string,
  input: AddSubjectInput,
): Promise<SubjectRow> {
  return createSubjectRow(db, dataRoot, input);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function listSubjectRows(db: any): Promise<SubjectRow[]> {
  return db.select().from(subjects).orderBy(subjects.name);
}

export type { Database };
