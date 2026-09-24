import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Loads a versioned prompt from `packages/ai/prompts/<name>/v<version>.md`
 * (docs/03-ai-e-worker.md §6 "Disciplina dei prompt"). The returned
 * `promptVersion` (e.g. "flashcards/v1") is what gets stamped on every
 * artifact this prompt produces — it's how a UI or CLI knows exactly which
 * prompt generated a given deck.
 */
export function loadPrompt(name: string, version: number): { text: string; promptVersion: string } {
  const path = resolve(__dirname, '..', 'prompts', name, `v${version}.md`);
  const text = readFileSync(path, 'utf-8').trim();
  return { text, promptVersion: `${name}/v${version}` };
}
