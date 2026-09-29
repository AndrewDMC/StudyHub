import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Path to spawn for the `claude` CLI. On Windows the npm install exposes only
 * a `claude.cmd` shim, which Node can't spawn without a shell — and a shell
 * is exactly what we avoid (prompts travel in argv). So resolve the real
 * `claude.exe` the shim points at. Elsewhere plain `claude` on PATH works.
 */
export function resolveClaudeBinary(): string {
  if (process.platform !== 'win32') return 'claude';
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    if (existsSync(join(dir, 'claude.exe'))) return join(dir, 'claude.exe');
    if (existsSync(join(dir, 'claude.cmd'))) {
      const exe = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return 'claude';
}
