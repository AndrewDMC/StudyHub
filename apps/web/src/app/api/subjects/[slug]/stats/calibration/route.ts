import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCalibration } from '@/lib/calibration';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { slug } = await params;
  try {
    return NextResponse.json({ calibration: await getCalibration(getDb(), slug) });
  } catch (err) {
    return errorResponse(err);
  }
}
