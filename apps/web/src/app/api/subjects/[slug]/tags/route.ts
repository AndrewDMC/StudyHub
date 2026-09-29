import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listTags } from '@/lib/deckEditor';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    return NextResponse.json({ tags: await listTags(getDb(), slug) });
  } catch (err) {
    return errorResponse(err);
  }
}
