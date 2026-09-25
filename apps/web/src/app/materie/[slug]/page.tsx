import { Suspense } from 'react';
import { SubjectDetailClient } from '@/components/SubjectDetailClient';

export default async function SubjectDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1440px] p-6 text-sm text-fg-muted">Caricamento…</div>}>
      <SubjectDetailClient slug={slug} />
    </Suspense>
  );
}
