import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SubjectColorSchema, type SubjectColor } from './colors.js';

export const MANIFEST_FILENAME = 'subject.json';
export const CURRENT_MANIFEST_SCHEMA_VERSION = 1;

/**
 * `subject.json` — the manifest that makes a folder under `subjects/` a subject.
 * `schemaVersion` is what lets a future FS migration detect and upgrade older
 * manifests in place (docs/fasi/F0-fondamenta.md "Manifest come contratto").
 */
export const SubjectManifestSchema = z.object({
  schemaVersion: z.literal(CURRENT_MANIFEST_SCHEMA_VERSION),
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  color: SubjectColorSchema,
  professor: z.string().min(1).optional(),
  cfu: z.number().int().positive().optional(),
  createdAt: z.string().datetime(),
});

export type SubjectManifest = z.infer<typeof SubjectManifestSchema>;

export class ManifestError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

export function createManifest(input: {
  name: string;
  slug: string;
  color: SubjectColor;
  professor?: string | undefined;
  cfu?: number | undefined;
  id?: string | undefined;
  createdAt?: Date | undefined;
}): SubjectManifest {
  return SubjectManifestSchema.parse({
    schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
    id: input.id ?? randomUUID(),
    slug: input.slug,
    name: input.name,
    color: input.color,
    professor: input.professor,
    cfu: input.cfu,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  });
}

export function manifestPath(subjectDir: string): string {
  return join(subjectDir, MANIFEST_FILENAME);
}

/** Reads and validates a subject's manifest. Throws {@link ManifestError} if missing or invalid. */
export async function readManifest(subjectDir: string): Promise<SubjectManifest> {
  const path = manifestPath(subjectDir);
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf-8');
  } catch (err: unknown) {
    throw new ManifestError(`cannot read manifest at ${path}`, err);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err: unknown) {
    throw new ManifestError(`manifest at ${path} is not valid JSON`, err);
  }

  const result = SubjectManifestSchema.safeParse(json);
  if (!result.success) {
    throw new ManifestError(
      `manifest at ${path} failed validation: ${result.error.message}`,
      result.error,
    );
  }
  return result.data;
}

/**
 * Writes the manifest atomically (write to a temp file in the same directory,
 * then rename) so a crash mid-write never leaves a truncated `subject.json`.
 */
export async function writeManifest(subjectDir: string, manifest: SubjectManifest): Promise<void> {
  const validated = SubjectManifestSchema.parse(manifest);
  const path = manifestPath(subjectDir);
  const tmpPath = join(subjectDir, `.${MANIFEST_FILENAME}.tmp-${process.pid}-${Date.now()}`);
  const contents = `${JSON.stringify(validated, null, 2)}\n`;
  await fs.writeFile(tmpPath, contents, 'utf-8');
  await fs.rename(tmpPath, path);
}

export async function manifestExists(subjectDir: string): Promise<boolean> {
  try {
    await fs.access(manifestPath(subjectDir));
    return true;
  } catch {
    return false;
  }
}
