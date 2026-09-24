import { ArtifactReviewClient } from '@/components/ArtifactReviewClient';

export default async function ArtifactReviewPage({
  params,
}: {
  params: Promise<{ slug: string; artifactId: string }>;
}) {
  const { slug, artifactId } = await params;
  return <ArtifactReviewClient subjectSlug={slug} artifactId={artifactId} />;
}
