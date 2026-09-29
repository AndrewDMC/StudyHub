#!/usr/bin/env node
/**
 * Fails when a secret could be reachable from the browser (docs/fasi/F7 acceptance criterion:
 * "nessuna chiave API raggiungibile dal client, verificato nel bundle").
 *
 * Scans what Next ships to clients — `.next/static` (JS/CSS/HTML/maps) — for:
 *   - the *values* of secrets present in the environment when it runs (API keys, DB/Redis URLs), and
 *   - well-known key shapes (Anthropic/OpenAI/AWS/private keys), whatever the environment holds.
 * Server-only output (`.next/server`) is deliberately not scanned: secrets legitimately live there.
 *
 *   node scripts/check-bundle-secrets.mjs [dir=apps/web/.next/static]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Env vars whose values must never appear in a client bundle. */
export const SECRET_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'VOYAGE_API_KEY',
  'DATABASE_URL',
  'REDIS_URL',
];

/** Shapes of well-known credentials. Deliberately narrow: a false alarm here trains people to ignore it. */
export const SECRET_PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'OpenAI-style API key', re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Postgres URL with password', re: /postgres(?:ql)?:\/\/[^\s:@/"']+:[^\s@/"']+@/ },
];

const MIN_SECRET_LENGTH = 8; // shorter "values" (e.g. DATABASE_URL=x) would match everything

/**
 * @param {string} file
 * @param {string} text
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ file: string, finding: string }[]}
 */
export function scanText(file, text, env = process.env) {
  const findings = [];
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) findings.push({ file, finding: name });
  }
  for (const key of SECRET_ENV_VARS) {
    const value = env[key];
    if (value && value.length >= MIN_SECRET_LENGTH && text.includes(value)) {
      findings.push({ file, finding: `value of ${key}` });
    }
  }
  return findings;
}

const SCANNED = /\.(js|mjs|css|html|json|map|txt)$/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SCANNED.test(entry)) yield path;
  }
}

/**
 * @param {string} dir
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ scanned: number, findings: { file: string, finding: string }[] }}
 */
export function scanDirectory(dir, env = process.env) {
  let scanned = 0;
  const findings = [];
  for (const file of walk(dir)) {
    scanned += 1;
    findings.push(...scanText(file, readFileSync(file, 'utf-8'), env));
  }
  return { scanned, findings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = resolve(process.argv[2] ?? 'apps/web/.next/static');
  let result;
  try {
    result = scanDirectory(dir);
  } catch (err) {
    console.error(`Cannot scan ${dir}: ${err.message}\nBuild the web app first (pnpm build).`);
    process.exit(2);
  }
  if (result.scanned === 0) {
    console.error(`No files under ${dir}: a scan that looked at nothing proves nothing.`);
    process.exit(2);
  }
  if (result.findings.length > 0) {
    for (const f of result.findings) console.error(`LEAK  ${f.finding}  in  ${f.file}`);
    process.exit(1);
  }
  console.log(`OK  ${result.scanned} client files scanned, no secrets found.`);
}
