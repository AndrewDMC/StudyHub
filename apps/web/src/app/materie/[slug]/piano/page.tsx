import { PlanClient } from '@/components/PlanClient';

export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PlanClient slug={slug} />;
}
