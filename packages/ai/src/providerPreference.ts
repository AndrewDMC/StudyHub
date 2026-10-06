import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type ProviderPreference = 'claude-cli' | 'auto';

/** Models the global selector offers (the ones with a known price, see `pricing.ts`), cheapest first. */
export const SELECTABLE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — veloce ed economico' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 — equilibrato' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 — il più capace' },
] as const;

/**
 * Lives in the data root (shared by web, worker and CLI, unlike an env var
 * that only one process sees). Sits beside — not inside — `subjects/`, so
 * the reconcile scan never sees it.
 */
function preferencePath(): string {
  return resolve(process.env.STUDYHUB_DATA_DIR ?? './data', '.studyhub-ai-provider.json');
}

interface PreferenceFile {
  provider?: string;
  model?: string | undefined;
}

function readFile(): PreferenceFile {
  try {
    const parsed = JSON.parse(readFileSync(preferencePath(), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as PreferenceFile) : {};
  } catch {
    return {};
  }
}

/** Provider and model share one file: writing one must keep the other. */
function writeFile(patch: PreferenceFile): void {
  const path = preferencePath();
  mkdirSync(dirname(path), { recursive: true });
  const next: PreferenceFile = { ...readFile(), ...patch };
  if (next.model === undefined) delete next.model;
  writeFileSync(path, JSON.stringify(next), 'utf8');
}

export function readProviderPreference(): ProviderPreference {
  return readFile().provider === 'claude-cli' ? 'claude-cli' : 'auto';
}

export function writeProviderPreference(provider: ProviderPreference): void {
  writeFile({ provider });
}

/** The model the student forced for every AI function, or null = each function keeps its own default. */
export function readModelPreference(): string | null {
  const model = readFile().model;
  return SELECTABLE_MODELS.some((m) => m.id === model) ? (model as string) : null;
}

export function writeModelPreference(model: string | null): void {
  if (model !== null && !SELECTABLE_MODELS.some((m) => m.id === model)) {
    throw new Error(`Modello non selezionabile: ${model}`);
  }
  writeFile({ model: model ?? undefined });
}

/**
 * The model a function runs with when the request does not name one: the global choice if there is one,
 * else the function's own default (Haiku to extract, Sonnet to generate, Opus to reason — docs/03 §4).
 */
export function resolveModel(functionDefault: string): string {
  return readModelPreference() ?? functionDefault;
}
