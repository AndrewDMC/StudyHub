import { spawn, type ChildProcess } from 'node:child_process';
import { resolveClaudeBinary } from './claudeBinary.js';
import { writeProviderPreference } from './providerPreference.js';

export interface ClaudeAuthStatus {
  /** `false` when the `claude` binary isn't on PATH (e.g. the web container) — login can't be driven from here. */
  cliAvailable: boolean;
  loggedIn: boolean;
  authMethod?: string | undefined;
  email?: string | undefined;
  orgName?: string | undefined;
  subscriptionType?: string | undefined;
}

export interface ClaudeLoginState {
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  /** OAuth URL printed by `claude auth login`, shown as a fallback when the browser doesn't open by itself. */
  url?: string | undefined;
  error?: string | undefined;
}

const LOGIN_TIMEOUT_MS = 5 * 60_000;

interface CliRun {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** argv-only spawn (no shell). Rejects with `ENOENT` when `claude` isn't installed. */
function runClaude(args: string[]): Promise<CliRun> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(resolveClaudeBinary(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ stdout, stderr, code }));
  });
}

export async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
  try {
    const { stdout } = await runClaude(['auth', 'status']);
    const info = JSON.parse(stdout) as {
      loggedIn?: boolean;
      authMethod?: string;
      email?: string;
      orgName?: string;
      subscriptionType?: string;
    };
    return {
      cliAvailable: true,
      loggedIn: info.loggedIn === true,
      authMethod: info.authMethod,
      email: info.email,
      orgName: info.orgName,
      subscriptionType: info.subscriptionType,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { cliAvailable: false, loggedIn: false };
    }
    // Binary present but produced non-JSON output: treat as "not logged in" rather than failing the settings page.
    return { cliAvailable: true, loggedIn: false };
  }
}

export async function claudeLogout(): Promise<void> {
  await runClaude(['auth', 'logout']);
}

/** Authorization codes are URL-safe tokens (`code#state`); anything else never reaches the CLI's stdin. */
export const AUTH_CODE_RE = /^[A-Za-z0-9_\-#.~%]{8,512}$/;

const URL_RE = /https:\/\/[^\s"'<>]+/;

/**
 * Drives `claude auth login --claudeai` (subscription, not Console/API billing).
 * The CLI opens the system browser itself and waits on its own localhost
 * callback; we only track the process and surface the printed URL. One login
 * at a time — a second `start` while one is running returns the current state.
 */
class ClaudeLoginSession {
  private child: ChildProcess | null = null;
  private timer: NodeJS.Timeout | null = null;
  private state: ClaudeLoginState = { status: 'idle' };

  get(): ClaudeLoginState {
    return { ...this.state };
  }

  start(): ClaudeLoginState {
    if (this.child) return this.get();
    this.state = { status: 'running' };

    let child: ChildProcess;
    try {
      child = spawn(resolveClaudeBinary(), ['auth', 'login', '--claudeai'], {
        // stdin stays open: without a browser (Docker) the CLI prints the sign-in
        // URL and waits for the code shown after sign-in to be pasted here.
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.state = { status: 'failed', error: (err as Error).message };
      return this.get();
    }
    this.child = child;

    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const url = URL_RE.exec(output)?.[0];
      if (url && this.state.status === 'running') this.state = { ...this.state, url };
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    const finish = (next: ClaudeLoginState) => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.child = null;
      this.state = next;
    };

    child.on('error', (err) =>
      finish({
        status: 'failed',
        error:
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'CLI `claude` non trovata: installa Claude Code sulla macchina che esegue StudyHub.'
            : err.message,
      }),
    );
    child.on('close', (code) => {
      if (code === 0) {
        // A successful sign-in is an intent to use the subscription: no second click needed.
        writeProviderPreference('claude-cli');
        finish({ status: 'succeeded' });
        return;
      }
      finish({
        status: 'failed',
        error: output.trim().slice(-300) || `login terminato (exit ${code})`,
      });
    });

    this.timer = setTimeout(() => {
      child.kill();
      finish({ status: 'failed', error: 'Tempo scaduto: login non completato entro 5 minuti.' });
    }, LOGIN_TIMEOUT_MS);

    return this.get();
  }

  /** Feeds the pasted authorization code to the waiting `claude auth login`. Returns false when no login is waiting or the code is malformed. */
  submitCode(code: string): boolean {
    const trimmed = code.trim();
    if (!this.child?.stdin || this.state.status !== 'running') return false;
    if (!AUTH_CODE_RE.test(trimmed)) return false;
    this.child.stdin.write(`${trimmed}
`);
    return true;
  }

  cancel(): void {
    if (!this.child) return;
    this.child.kill();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.child = null;
    this.state = { status: 'idle' };
  }
}

// Module-level singleton: survives across requests in the long-lived Next server process.
const globalKey = Symbol.for('studyhub.claudeLoginSession');
const holder = globalThis as unknown as Record<symbol, ClaudeLoginSession | undefined>;
export const claudeLogin: ClaudeLoginSession = (holder[globalKey] ??= new ClaudeLoginSession());
