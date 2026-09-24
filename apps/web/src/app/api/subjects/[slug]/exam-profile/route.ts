import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UpdateExamProfileRequestSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { enqueueExamProfileExtraction, getExamProfile, updateExamProfile } from '@/lib/examPrep';
import { errorResponse, parseBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    return NextResponse.json({ profile: await getExamProfile(getDb(), slug) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Starts (re-)extraction from the subject's past exams. */
export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await parseBody(request, z.object({ overwriteEdited: z.boolean().default(false) }));
  if (body.error) return body.error;
  try {
    const result = await enqueueExamProfileExtraction(getDb(), getJobQueue(), slug, body.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** User edit: the profile becomes theirs (`edited`) and re-extraction won't overwrite it by default. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await parseBody(request, UpdateExamProfileRequestSchema);
  if (body.error) return body.error;
  try {
    return NextResponse.json({ profile: await updateExamProfile(getDb(), slug, body.data) });
  } catch (err) {
    return errorResponse(err);
  }
}
