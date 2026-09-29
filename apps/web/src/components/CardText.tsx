'use client';

import { useMemo } from 'react';
import { renderCardHtml, type CardSide } from '@/lib/cardText';

/** A card face with cloze, KaTeX and images resolved — see `renderCardHtml` for what's supported. */
export function CardText({
  text,
  side,
  className,
}: {
  text: string;
  side: CardSide;
  className?: string;
}) {
  const html = useMemo(() => renderCardHtml(text, side), [text, side]);
  // The HTML comes from `renderCardHtml`, which escapes everything but the markup it emits itself.
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
