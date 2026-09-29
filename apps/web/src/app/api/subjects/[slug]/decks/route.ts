import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { createDeck } from '@/lib/deckEditor';
import { errorResponse, parseBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

const CreateDeckRequestSchema = z.object({
  title: z.string().trim().min(1, 'Il titolo non può essere vuoto').max(120),
});

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data, error } = await parseBody(request, CreateDeckRequestSchema);
  if (error) return error;
  try {
    return NextResponse.json(
      { deck: await createDeck(getDb(), slug, data.title) },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
