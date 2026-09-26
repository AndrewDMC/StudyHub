import { DocumentContentClient } from '@/components/DocumentContentClient';

export default async function DocumentContentPage({
  params,
}: {
  params: Promise<{ slug: string; documentId: string }>;
}) {
  const { slug, documentId } = await params;
  return <DocumentContentClient subjectSlug={slug} documentId={documentId} />;
}
