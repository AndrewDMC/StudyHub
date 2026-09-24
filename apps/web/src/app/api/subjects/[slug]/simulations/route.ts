import { NextResponse } from 'next/server';
import { GenerateSimulationJobInputSchema } from '@studyhub/contracts';
import { getDb } from '@/lib/db';
import { getJobQueue } from '@/lib/queue';
import { enqueueSimulation, listSimulations } from '@/lib/examPrep';
import { errorResponse, parseBody } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

// subjectId comes from the URL, never from the body.
const RequestSchema = GenerateSimulationJobInputSchema.innerType()
  .omit({ subjectId: true })
  .refine((v) => v.mode !== 'drill_argomento' || !!v.topicId, {
    message: 'Il drill richiede un argomento (topicId)',
  });

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    return NextResponse.json({ simulations: await listSimulations(getDb(), slug) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { slug } = await params;
  const body = await parseBody(request, RequestSchema);
  if (body.error) return body.error;
  try {
    return NextResponse.json(await enqueueSimulation(getDb(), getJobQueue(), slug, body.data), {
      status: 202,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
