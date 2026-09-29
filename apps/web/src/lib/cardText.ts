import katex from 'katex';
import { displayMathRe, inlineMathRe } from './mathSyntax';

export type CardSide = 'front' | 'back';

/**
 * Renders a flashcard's `front`/`back` to safe HTML (docs/fasi/F4-flashcard.md "Supporto cloze,
 * formule KaTeX, immagini"). The whole text is HTML-escaped first; only the constructs below are
 * turned back into markup, so card content — which may come from an imported deck — can never
 * inject tags:
 *
 * - `$...$` / `$$...$$` → KaTeX (`trust: false`, errors render as the raw source, never throw)
 * - `{{c1::answer}}` / `{{c1::answer::hint}}` (Anki) and `{{...}}` (what the generator emits) →
 *   on the front a blank, on the back the answer highlighted
 * - `![alt](url)` → `<img>`, only for `/api/…`, `http(s)://…` and `data:image/…` URLs
 */
const MATH_OPEN = '';
const MATH_CLOSE = '';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

const SAFE_IMAGE_URL = /^(\/api\/|https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i;

function renderMath(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, trust: false });
}

export function renderCardHtml(text: string, side: CardSide): string {
  // 1. Pull math out before escaping so `<`/`&` inside a formula reach KaTeX untouched.
  const maths: string[] = [];
  const stash = (tex: string, displayMode: boolean) => {
    maths.push(renderMath(tex, displayMode));
    return `${MATH_OPEN}${maths.length - 1}${MATH_CLOSE}`;
  };
  let out = text
    .replaceAll(MATH_OPEN, '')
    .replaceAll(MATH_CLOSE, '')
    .replace(displayMathRe(), (_m, tex: string) => stash(tex, true))
    .replace(inlineMathRe(), (_m, tex: string) => stash(tex, false));

  // 2. Escape everything that is left.
  out = escapeHtml(out);

  // 3. Cloze.
  out = out.replace(
    /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g,
    (_m, answer: string, hint: string | undefined) =>
      side === 'front'
        ? `<span class="cloze-blank">[${hint ? hint : '…'}]</span>`
        : `<span class="cloze-answer">${answer}</span>`,
  );
  out = out.replace(/\{\{\.\.\.\}\}/g, '<span class="cloze-blank">[…]</span>');

  // 4. Images. The URL is already escaped, which is exactly what an attribute needs.
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt: string, url: string) => {
    const raw = url.replaceAll('&amp;', '&');
    return SAFE_IMAGE_URL.test(raw)
      ? `<img src="${url}" alt="${alt}" class="card-image" loading="lazy" />`
      : whole;
  });

  out = out.replace(/\r?\n/g, '<br />');

  // 5. Put the formulas back.
  return out.replace(
    new RegExp(`${MATH_OPEN}(\\d+)${MATH_CLOSE}`, 'g'),
    (_m, i: string) => maths[Number(i)] ?? '',
  );
}

const ANKI_CLOZE_RE = /\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g;

/** The sentence with every `{{c1::answer}}` replaced by its answer — the cloze card, solved. */
export function solveCloze(text: string): string {
  return text.replace(ANKI_CLOZE_RE, '$1');
}

/**
 * What a card face shows. A cloze card written in Anki syntax carries its answers inside `front`
 * (`{{c1::x}}`): once revealed, that same text with the answers filled in *is* the answer, so the
 * back is shown only when it adds something. Every other card — including the generator's
 * cloze cards, whose `front` holds a `{{...}}` blank and whose `back` is the full sentence —
 * keeps the plain front/back split.
 */
export function revealPlan(
  card: { type: string; front: string; back: string },
  revealed: boolean,
): { frontSide: CardSide; showBack: boolean } {
  const solvedInFront = card.type === 'cloze' && new RegExp(ANKI_CLOZE_RE.source).test(card.front);
  if (!solvedInFront) return { frontSide: 'front', showBack: revealed };
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const backIsJustTheSentence = norm(card.back) === norm(solveCloze(card.front));
  return { frontSide: revealed ? 'back' : 'front', showBack: revealed && !backIsJustTheSentence };
}
