import { NextResponse } from 'next/server';

// No DB/FS check on purpose: this is the container liveness probe
// (docker/Dockerfile.web), it must stay independent of Postgres/volume state.
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
