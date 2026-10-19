'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  flashcardsHref,
  parseFlashcardsParams,
  type FlashcardsParams,
  type FlashcardsPatch,
} from '@/lib/flashcardsView';

/** The tab's query params of the current URL, with helpers to build/replace/push the next one. */
export function useFlashcardsParams(slug: string): {
  params: FlashcardsParams;
  href: (patch: FlashcardsPatch) => string;
  replace: (patch: FlashcardsPatch) => void;
  push: (patch: FlashcardsPatch) => void;
} {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useMemo(() => parseFlashcardsParams(searchParams), [searchParams]);
  const href = useCallback(
    (patch: FlashcardsPatch) => flashcardsHref(slug, searchParams, patch),
    [slug, searchParams],
  );
  const replace = useCallback(
    (patch: FlashcardsPatch) => router.replace(href(patch), { scroll: false }),
    [router, href],
  );
  const push = useCallback(
    (patch: FlashcardsPatch) => router.push(href(patch), { scroll: false }),
    [router, href],
  );
  return { params, href, replace, push };
}
