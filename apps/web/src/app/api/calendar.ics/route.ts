import { getDb } from '@/lib/db';
import { getIcsFeed } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

/**
 * Subscribable ICS feed (docs/fasi/F6-planner-calendario.md scope: "Export ICS, feed
 * sottoscrivibile"). Plain-text response, not JSON — a calendar client (Google Calendar, Apple
 * Calendar, …) re-fetches this same URL on its own schedule and expects `text/calendar`.
 */
export async function GET() {
  const ics = await getIcsFeed(getDb());
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="studyhub.ics"',
    },
  });
}
