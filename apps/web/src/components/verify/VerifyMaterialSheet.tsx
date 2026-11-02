'use client';

import type { ReactNode, RefObject } from 'react';
import type { SessionDocumentDto } from '@studyhub/contracts';
import { BottomSheet } from '@/components/subject-mobile/BottomSheet';
import {
  VerifyMaterialPanel,
  type VerifyMaterialTarget,
} from '@/components/verify/VerifyMaterialPanel';

/**
 * The material of a key point on a phone: a sheet from the bottom instead of a panel at the end of
 * the page. The focus goes back to the key point that opened it.
 */
export function VerifyMaterialSheet({
  docs,
  target,
  onClose,
  returnFocusRef,
  renderDocument,
}: {
  docs: SessionDocumentDto[];
  /** `null`: closed. */
  target: VerifyMaterialTarget | null;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  renderDocument: (props: {
    doc: SessionDocumentDto;
    canAsk: boolean;
    onAsk: () => void;
    target: { page: number; nonce: number } | null;
  }) => ReactNode;
}) {
  return (
    <BottomSheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Materiale"
      returnFocusRef={returnFocusRef}
    >
      {target && (
        <div className="mt-2 flex h-[70dvh] flex-col [&>aside]:min-h-0 [&>aside]:flex-1">
          <VerifyMaterialPanel
            docs={docs}
            target={target}
            onClose={onClose}
            renderDocument={renderDocument}
          />
        </div>
      )}
    </BottomSheet>
  );
}
