'use client';

import type { RefObject } from 'react';
import Link from 'next/link';
import { secondaryButton } from '../simulation-mobile/styles';
import { BottomSheet } from '../subject-mobile/BottomSheet';

/** A cited passage: item citations carry the quote, chat citations only document and page. */
export interface SourceRef {
  docId: string;
  documentName: string;
  page: number;
  quote?: string | undefined;
}

export function SourceSheet({
  slug,
  source,
  onOpenChange,
  returnFocusRef,
}: {
  slug: string;
  source: SourceRef | null;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  return (
    <BottomSheet
      open={source !== null}
      onOpenChange={onOpenChange}
      title="Fonte"
      description={source ? `${source.documentName} · p. ${source.page}` : undefined}
      returnFocusRef={returnFocusRef}
    >
      {source && (
        <div className="flex flex-col gap-3 pt-1">
          {source.quote && (
            <blockquote className="mt-2 break-words border-l-2 border-accent pl-3 text-[15px] leading-normal text-fg-primary">
              «{source.quote}»
            </blockquote>
          )}
          <Link
            href={`/materie/${slug}/documenti/${source.docId}`}
            className={`${secondaryButton} min-h-11`}
          >
            Apri il documento
          </Link>
        </div>
      )}
    </BottomSheet>
  );
}
