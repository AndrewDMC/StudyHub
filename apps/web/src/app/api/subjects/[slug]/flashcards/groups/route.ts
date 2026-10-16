import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { errorResponse } from '@/lib/http';
import { listDeckGroups } from '@/lib/flashcardGroups';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    return NextResponse.json({ groups: await listDeckGroups(getDb(), slug) });
  } catch (err) {
    return errorResponse(err);
  }
}
