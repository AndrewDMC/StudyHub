import { SessionClient } from '@/components/SessionClient';

export default async function SessionPage({
  params,
}: {
  params: Promise<{ slug: string; sessionId: string }>;
}) {
  const { slug, sessionId } = await params;
  return <SessionClient slug={slug} sessionId={sessionId} />;
}
