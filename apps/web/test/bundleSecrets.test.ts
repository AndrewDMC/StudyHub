import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDirectory, scanText } from '../../../scripts/check-bundle-secrets.mjs';

describe('check-bundle-secrets', () => {
  it('flags well-known key shapes, whatever the environment holds', () => {
    const anthropic = `const k="sk-ant-api03-${'a'.repeat(40)}"`;
    expect(scanText('a.js', anthropic, {})[0]?.finding).toBe('Anthropic API key');
    expect(scanText('a.js', 'x AKIAABCDEFGHIJKLMNOP y', {})).toHaveLength(1);
    expect(scanText('a.js', '-----BEGIN RSA PRIVATE KEY-----', {})).toHaveLength(1);
    expect(scanText('a.js', 'postgres://studyhub:hunter2@db:5432/studyhub', {})).toHaveLength(1);
  });

  it('flags the actual value of a secret env var, and names the variable', () => {
    const env = { ANTHROPIC_API_KEY: 'super-secret-value-123' };
    const found = scanText('chunk.js', 'var a="super-secret-value-123";', env);
    expect(found).toEqual([{ file: 'chunk.js', finding: 'value of ANTHROPIC_API_KEY' }]);
  });

  it('does not flag ordinary code, the variable NAME, or a too-short env value', () => {
    expect(scanText('a.js', 'process.env.ANTHROPIC_API_KEY; const sk = 1;', {})).toEqual([]);
    expect(scanText('a.js', 'anything x', { DATABASE_URL: 'x' })).toEqual([]);
    expect(
      scanText('a.js', 'a postgres URL without credentials postgres://db/studyhub', {}),
    ).toEqual([]);
  });

  describe('scanDirectory', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'studyhub-bundle-'));
      await mkdir(join(dir, 'chunks'), { recursive: true });
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('walks nested files and reports the leaking one', async () => {
      await writeFile(join(dir, 'chunks', 'ok.js'), 'console.log("hi")');
      await writeFile(join(dir, 'chunks', 'leak.js'), `x="sk-ant-${'b'.repeat(30)}"`);
      await writeFile(join(dir, 'logo.png'), 'sk-ant-not-scanned-binary-type-xxxxxxxx');
      const result = scanDirectory(dir, {});
      expect(result.scanned).toBe(2);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.file).toContain('leak.js');
    });

    it('reports a clean bundle as clean', async () => {
      await writeFile(join(dir, 'chunks', 'ok.js'), 'console.log("hi")');
      expect(scanDirectory(dir, {}).findings).toEqual([]);
    });
  });
});
