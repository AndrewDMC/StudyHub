import type { AiProvider } from './provider.js';
import { FakeProvider } from './fakeProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { ClaudeCliProvider } from './claudeCliProvider.js';

/**
 * `AI_PROVIDER=claude-cli` -> shells out to the `claude` CLI, using whatever
 * subscription it's already logged into (docker/docker-compose.claude-cli.yml
 * mounts the host's `~/.claude`/`~/.claude.json` for this). Otherwise
 * `ANTHROPIC_API_KEY` set -> the billed Messages API. Otherwise the
 * deterministic `FakeProvider` (docs/fasi/F3-ai-core.md "Stato" addendum) —
 * the app stays fully usable, and the review queue / costs / job lifecycle
 * are all real, just against simulated content until a provider is configured.
 */
export function resolveProvider(): AiProvider {
  if (process.env.AI_PROVIDER === 'claude-cli') return new ClaudeCliProvider();
  return process.env.ANTHROPIC_API_KEY ? new AnthropicProvider() : new FakeProvider();
}
