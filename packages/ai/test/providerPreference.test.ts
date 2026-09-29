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

describe('claude login code handling', () => {
  it('accepts URL-safe authorization codes only', async () => {
    const { AUTH_CODE_RE } = await import('../src/claudeAuth.js');
    expect(AUTH_CODE_RE.test('abc123XYZ_-.~#state987')).toBe(true);
    expect(AUTH_CODE_RE.test('short')).toBe(false);
    expect(AUTH_CODE_RE.test('has space in it')).toBe(false);
    expect(AUTH_CODE_RE.test('line1\nrm -rf /')).toBe(false);
  });

  it('refuses a code when no login is waiting', async () => {
    const { claudeLogin } = await import('../src/claudeAuth.js');
    expect(claudeLogin.submitCode('abcdefgh12345678')).toBe(false);
  });
});
