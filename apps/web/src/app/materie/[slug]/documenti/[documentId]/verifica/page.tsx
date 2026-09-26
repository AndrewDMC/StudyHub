import { VerifySchemaClient } from '@/components/VerifySchemaClient';

export default async function VerifySchemaPage({
  params,
}: {
  params: Promise<{ slug: string; documentId: string }>;
}) {
  const { slug, documentId } = await params;
  return <VerifySchemaClient subjectSlug={slug} documentId={documentId} />;
}
