'use client';

import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

/** Photo thumbnail; when the browser cannot decode it (typically HEIC outside Safari) it shows a placeholder. */
export function PhotoImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center"
      >
        <ImageIcon className="size-5 text-fg-muted" aria-hidden="true" />
        <span className="text-xs text-fg-muted">Anteprima non disponibile</span>
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
  );
}
