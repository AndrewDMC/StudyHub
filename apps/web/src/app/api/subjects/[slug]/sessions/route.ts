import { NextResponse } from 'next/server';
import { StartSessionRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { startSession } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

/** "Inizia" su una task (o su degli argomenti): apre — o riapre — la sessione di studio. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await parseBody(request, StartSessionRequestSchema);
  if (body.error) return body.error;
  try {
    const session = await startSession(getDb(), slug, body.data);
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
