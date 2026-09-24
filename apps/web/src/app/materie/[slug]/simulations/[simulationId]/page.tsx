import { ExamModeClient } from '@/components/ExamModeClient';

export default async function ExamModePage({
  params,
}: {
  params: Promise<{ slug: string; simulationId: string }>;
}) {
  const { slug, simulationId } = await params;
  return <ExamModeClient subjectSlug={slug} simulationId={simulationId} />;
}
