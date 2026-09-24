import { SubjectDetailClient } from '@/components/SubjectDetailClient';

export default async function SubjectDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SubjectDetailClient slug={slug} />;
}
