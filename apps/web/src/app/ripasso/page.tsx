import { QuickReviewClient } from '@/components/quick-review/QuickReviewClient';
import { scopeFromSearchParams } from '@/lib/quickReview';

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

/**
 * Ripasso rapido (docs/09-ripasso-mobile.md §C). `?materia=<slug>&argomento=<topicId|none>&task=<taskId>&n=10`
 * opens straight into a session.
 */
export default async function RipassoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const scope = scopeFromSearchParams({
    materia: one(params.materia),
    argomento: one(params.argomento),
    task: one(params.task),
  });
  const n = Number(one(params.n));
  const limit = Number.isInteger(n) && n > 0 && n <= 500 ? n : null;
  return <QuickReviewClient deepLink={scope ? { scope, limit } : null} />;
}
