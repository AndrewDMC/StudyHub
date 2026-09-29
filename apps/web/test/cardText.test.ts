import { describe, expect, it } from 'vitest';
import { renderCardHtml, revealPlan, solveCloze } from '../src/lib/cardText';

describe('renderCardHtml', () => {
  it('escapes HTML so card content cannot inject markup', () => {
    const html = renderCardHtml('<script>alert(1)</script> <img src=x onerror=y>', 'front');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders inline and display math with KaTeX', () => {
    const html = renderCardHtml('Energia: $E=mc^2$ e $$\\int_0^1 x\\,dx$$', 'back');
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('$');
  });

  it('leaves currency-looking dollars alone', () => {
    const html = renderCardHtml('Costa $5 oggi e $6 domani', 'front');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5');
  });

  it('does not throw on invalid LaTeX', () => {
    expect(() => renderCardHtml('$\\frac{1$', 'front')).not.toThrow();
  });

  it('math with < and & survives escaping', () => {
    const html = renderCardHtml('$a < b$', 'front');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('&amp;lt;');
  });

  it('cloze: blank on the front, highlighted answer on the back (Anki syntax)', () => {
    const text = 'La capitale è {{c1::Roma}}.';
    expect(renderCardHtml(text, 'front')).toContain('<span class="cloze-blank">[…]</span>');
    expect(renderCardHtml(text, 'front')).not.toContain('Roma');
    expect(renderCardHtml(text, 'back')).toContain('<span class="cloze-answer">Roma</span>');
  });

  it('cloze hint replaces the ellipsis on the front', () => {
    const html = renderCardHtml('{{c1::Roma::città}}', 'front');
    expect(html).toContain('[città]');
  });

  it('the generator’s {{...}} marker becomes a blank', () => {
    expect(renderCardHtml('Il {{...}} è un fatto', 'front')).toContain('cloze-blank');
  });

  it('cloze answers can contain math', () => {
    const html = renderCardHtml('{{c1::$x^2$}}', 'back');
    expect(html).toContain('cloze-answer');
    expect(html).toContain('class="katex"');
  });

  it('renders images from allowed sources only', () => {
    expect(renderCardHtml('![grafico](/api/subjects/x/file?a=1&b=2)', 'front')).toContain(
      '<img src="/api/subjects/x/file?a=1&amp;b=2" alt="grafico"',
    );
    expect(renderCardHtml('![x](https://example.com/a.png)', 'front')).toContain('<img');
    expect(renderCardHtml('![x](data:image/png;base64,AAAA)', 'front')).toContain('<img');
    const bad = renderCardHtml('![x](javascript:alert(1))', 'front');
    expect(bad).not.toContain('<img');
    expect(renderCardHtml('![x](data:text/html;base64,AAAA)', 'front')).not.toContain('<img');
  });

  it('an attribute-breaking URL cannot escape the src attribute', () => {
    const html = renderCardHtml('![x](https://e.com/a"onerror="y)', 'front');
    expect(html).not.toMatch(/onerror="/);
  });

  it('turns newlines into line breaks', () => {
    expect(renderCardHtml('a\nb', 'front')).toBe('a<br />b');
  });
});

describe('revealPlan', () => {
  it('a plain card keeps front, then back on reveal', () => {
    expect(revealPlan({ type: 'basic', front: 'Q', back: 'A' }, false)).toEqual({
      frontSide: 'front',
      showBack: false,
    });
    expect(revealPlan({ type: 'basic', front: 'Q', back: 'A' }, true)).toEqual({
      frontSide: 'front',
      showBack: true,
    });
  });

  it('an Anki-syntax cloze fills its answers into the front on reveal', () => {
    const card = { type: 'cloze', front: 'La {{c1::velocità}} è x', back: 'Nota extra' };
    expect(revealPlan(card, false)).toEqual({ frontSide: 'front', showBack: false });
    expect(revealPlan(card, true)).toEqual({ frontSide: 'back', showBack: true });
  });

  it('hides a back that merely repeats the solved sentence', () => {
    const card = { type: 'cloze', front: 'La {{c1::velocità}} è x', back: 'La velocità è x' };
    expect(revealPlan(card, true)).toEqual({ frontSide: 'back', showBack: false });
  });

  it('the generator’s {{...}} cloze keeps front blank + full-sentence back', () => {
    const card = { type: 'cloze', front: 'La {{...}} è x', back: 'La velocità è x' };
    expect(revealPlan(card, true)).toEqual({ frontSide: 'front', showBack: true });
  });

  it('solveCloze drops the markup and the hint', () => {
    expect(solveCloze('A {{c1::b::hint}} e {{c2::c}}')).toBe('A b e c');
  });
});
