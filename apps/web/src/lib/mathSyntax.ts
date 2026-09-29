/**
 * The `$...$` / `$$...$$` math syntax cards are written in. Shared by the renderer
 * (`cardText.ts`) and the Anki converters (`anki.ts`) so both agree on what counts as a formula.
 * Functions, not constants: a global RegExp carries `lastIndex` state between uses.
 */
export const displayMathRe = () => /\$\$([\s\S]+?)\$\$/g;

/**
 * Inline math: no space just inside the `$`, and not followed by a digit — so "costa $5 e $6"
 * stays prose.
 */
export const inlineMathRe = () => /\$(?=\S)([^$\n]*?\S)\$(?!\d)/g;
