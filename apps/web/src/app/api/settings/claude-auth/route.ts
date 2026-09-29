import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  claudeLogin,
  claudeLogout,
  getClaudeAuthStatus,
  readProviderPreference,
  resolveProvider,
  writeProviderPreference,
} from '@studyhub/ai';
import { formatError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  action: z.enum(['login', 'submit-code', 'cancel-login', 'logout', 'use', 'stop-using']),
  code: z.string().max(512).optional(),
});

async function snapshot() {
  return {
    auth: await getClaudeAuthStatus(),
    login: claudeLogin.get(),
    preferred: readProviderPreference(),
    activeProvider: resolveProvider().name,
    // AI_PROVIDER set in the environment overrides the in-app choice.
    lockedByEnv: Boolean(process.env.AI_PROVIDER),
  };
}

/**
 * In-app Claude subscription login. Delegates to the `claude` CLI (`auth login
 * --claudeai`) — StudyHub never sees or stores an OAuth token; the CLI keeps its
 * own credentials and `ClaudeCliProvider` reuses them. Exposes only status
 * fields (email, plan), no secrets.
 */
export async function GET() {
  try {
    return NextResponse.json(await snapshot());
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Azione non valida' } },
      { status: 400 },
    );
  }
  try {
    switch (parsed.data.action) {
      case 'login':
        claudeLogin.start();
        break;
      case 'submit-code':
        if (!parsed.data.code || !claudeLogin.submitCode(parsed.data.code)) {
          return NextResponse.json(
            {
              error: {
                code: 'invalid_request',
                message: 'Codice non valido o nessun accesso in corso',
              },
            },
            { status: 400 },
          );
        }
        break;
      case 'cancel-login':
        claudeLogin.cancel();
        break;
      case 'logout':
        await claudeLogout();
        writeProviderPreference('auto');
        break;
      case 'use':
        writeProviderPreference('claude-cli');
        break;
      case 'stop-using':
        writeProviderPreference('auto');
        break;
    }
    return NextResponse.json(await snapshot());
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: formatError(err) } },
      { status: 500 },
    );
  }
}
