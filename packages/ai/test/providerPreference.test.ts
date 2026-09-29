import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProviderPreference, writeProviderPreference } from '../src/providerPreference.js';
import { resolveProvider } from '../src/resolveProvider.js';

describe('in-app provider preference', () => {
  let dir: string;
  const saved = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'studyhub-pref-'));
    process.env.STUDYHUB_DATA_DIR = dir;
    delete process.env.AI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to auto (fake provider) with no preference file', () => {
    expect(readProviderPreference()).toBe('auto');
    expect(resolveProvider().name).toBe('fake');
  });

  it('routes through claude-cli once "use" is saved', () => {
    writeProviderPreference('claude-cli');
    expect(resolveProvider().name).toBe('claude-cli');
    writeProviderPreference('auto');
    expect(resolveProvider().name).toBe('fake');
  });

  it('lets AI_PROVIDER in the environment override the saved preference', () => {
    writeProviderPreference('claude-cli');
    process.env.AI_PROVIDER = 'other';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(resolveProvider().name).toBe('anthropic');
  });
});
