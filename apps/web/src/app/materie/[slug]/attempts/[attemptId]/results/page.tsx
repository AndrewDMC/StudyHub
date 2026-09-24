import { AttemptResultsClient } from '@/components/AttemptResultsClient';

export default async function AttemptResultsPage({
  params,
}: {
  params: Promise<{ slug: string; attemptId: string }>;
}) {
  const { slug, attemptId } = await params;
  return <AttemptResultsClient subjectSlug={slug} attemptId={attemptId} />;
}
