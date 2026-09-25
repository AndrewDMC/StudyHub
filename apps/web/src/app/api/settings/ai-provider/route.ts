import { NextResponse } from 'next/server';
import { resolveProvider } from '@studyhub/ai';

export const dynamic = 'force-dynamic';

/**
 * Exposes only `resolveProvider().name` ('fake' | 'anthropic' | 'claude-cli')
 * — never a key or env var — so the UI can tell a real generation from a
 * simulated one without any secret reaching the client
 * (docs/01-architettura.md §5: no key in the client bundle).
 */
export async function GET() {
  return NextResponse.json({ provider: resolveProvider().name });
}
