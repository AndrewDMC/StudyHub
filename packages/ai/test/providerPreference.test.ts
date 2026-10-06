import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readModelPreference,
  readProviderPreference,
  resolveModel,
  writeModelPreference,
  writeProviderPreference,
} from '../src/providerPreference.js';
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

describe('global model preference', () => {
  let dir: string;
  const saved = { ...process.env };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'studyhub-model-'));
    process.env.STUDYHUB_DATA_DIR = dir;
  });
  afterEach(() => {
    process.env = { ...saved };
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps each function on its own default until a model is forced', () => {
    expect(readModelPreference()).toBeNull();
    expect(resolveModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001');
    writeModelPreference('claude-opus-5-5');
    expect(resolveModel('claude-haiku-4-5-20251001')).toBe('claude-opus-5-5');
    writeModelPreference(null);
    expect(resolveModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
  });

  it('refuses a model that is not on the list, and ignores a tampered file', () => {
    expect(() => writeModelPreference('gpt-4')).toThrow(/non selezionabile/);
    writeFileSync(join(dir, '.studyhub-ai-provider.json'), '{"model":"gpt-4"}', 'utf8');
    expect(readModelPreference()).toBeNull();
  });

  it('shares the file with the provider choice without erasing either', () => {
    writeProviderPreference('claude-cli');
    writeModelPreference('claude-sonnet-5-5');
    expect(readProviderPreference()).toBe('claude-cli');
    writeProviderPreference('auto');
    expect(readModelPreference()).toBe('claude-sonnet-5-5');
    expect(JSON.parse(readFileSync(join(dir, '.studyhub-ai-provider.json'), 'utf8'))).toEqual({
      provider: 'auto',
      model: 'claude-sonnet-5-5',
    });
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
