import type { AiProvider } from './provider.js';
import { FakeProvider } from './fakeProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';

/**
 * `ANTHROPIC_API_KEY` set -> the real provider. Otherwise the deterministic
 * `FakeProvider` (docs/fasi/F3-ai-core.md "Stato" addendum) — the app stays
 * fully usable, and the review queue / costs / job lifecycle are all real,
 * just against simulated content until a key is configured.
 */
export function resolveProvider(): AiProvider {
  return process.env.ANTHROPIC_API_KEY ? new AnthropicProvider() : new FakeProvider();
}
