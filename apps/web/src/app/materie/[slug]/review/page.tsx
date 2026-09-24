import { ReviewSessionClient } from '@/components/ReviewSessionClient';

export default async function ReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ReviewSessionClient subjectSlug={slug} />;
}
