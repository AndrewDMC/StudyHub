import { NextResponse } from 'next/server';
import { UpdateTaskFlashcardsRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { errorResponse, parseBody } from '@/lib/http';
import { getTaskFlashcards, updateTaskFlashcards } from '@/lib/taskFlashcards';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string; taskId: string }> };

/** Flashcards attached to a lesson (plan task): `TaskFlashcardsResponse`. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { slug, taskId } = await params;
  try {
    return NextResponse.json(await getTaskFlashcards(getDb(), slug, taskId));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Attach (`add`, source user) and/or detach (`remove`) cards; answers like GET. */
export async function PUT(request: Request, { params }: RouteParams) {
  const { slug, taskId } = await params;
  const { data, error } = await parseBody(request, UpdateTaskFlashcardsRequestSchema);
  if (error) return error;
  try {
    return NextResponse.json(await updateTaskFlashcards(getDb(), slug, taskId, data));
  } catch (err) {
    return errorResponse(err);
  }
}
