import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { resolveSubjectSubpath } from '@studyhub/core';

/** `subjects/<slug>/.studyhub/handwriting-profile.md` — per-subject learned conventions. */
export function subjectHandwritingProfilePath(slug: string, dataRoot: string): string {
  return resolveSubjectSubpath(slug, ['.studyhub', 'handwriting-profile.md'], dataRoot);
}

/** `<dataRoot>/.studyhub/handwriting-profile.md` — conventions that hold across every subject. */
export function globalHandwritingProfilePath(dataRoot: string): string {
  return join(dataRoot, '.studyhub', 'handwriting-profile.md');
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Combined profile passed to `AiProvider.transcribeSchema` (docs/07-markdown-layer.md
 * §5.4b) — subject-specific conventions first (more specific), then global
 * ones. `null` when neither file exists yet (nothing learned so far).
 */
export async function readHandwritingProfile(
  slug: string,
  dataRoot: string,
): Promise<string | undefined> {
  const [subjectProfile, globalProfile] = await Promise.all([
    readIfExists(subjectHandwritingProfilePath(slug, dataRoot)),
    readIfExists(globalHandwritingProfilePath(dataRoot)),
  ]);
  const parts = [subjectProfile, globalProfile].filter(
    (p): p is string => p !== null && p.trim() !== '',
  );
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

export async function appendHandwritingProfileLines(path: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  await fs.mkdir(join(path, '..'), { recursive: true });
  const existing = await readIfExists(path);
  const header = existing ? existing.trimEnd() + '\n' : '# Profilo di grafia\n';
  const addition = lines.map((l) => `- ${l}`).join('\n');
  await fs.writeFile(path, `${header}${addition}\n`, 'utf-8');
}
