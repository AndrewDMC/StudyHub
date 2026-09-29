import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type ProviderPreference = 'claude-cli' | 'auto';

/**
 * Lives in the data root (shared by web, worker and CLI, unlike an env var
 * that only one process sees). Sits beside — not inside — `subjects/`, so
 * the reconcile scan never sees it.
 */
function preferencePath(): string {
  return resolve(process.env.STUDYHUB_DATA_DIR ?? './data', '.studyhub-ai-provider.json');
}

export function readProviderPreference(): ProviderPreference {
  try {
    const parsed = JSON.parse(readFileSync(preferencePath(), 'utf8')) as { provider?: string };
    return parsed.provider === 'claude-cli' ? 'claude-cli' : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeProviderPreference(provider: ProviderPreference): void {
  const path = preferencePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ provider }), 'utf8');
}
