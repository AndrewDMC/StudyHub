import { DocumentViewerClient } from '@/components/DocumentViewerClient';

export default async function DocumentViewerPage({
  params,
}: {
  params: Promise<{ slug: string; documentId: string }>;
}) {
  const { slug, documentId } = await params;
  return <DocumentViewerClient subjectSlug={slug} documentId={documentId} />;
}
