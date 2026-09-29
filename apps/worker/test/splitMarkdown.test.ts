import { describe, expect, it } from 'vitest';
import { splitMarkdownSections } from '../src/processors/splitMarkdown.js';

describe('splitMarkdownSections', () => {
  it('splits at H1/H2 headings and keeps deeper headings inside their section', () => {
    const out = splitMarkdownSections('# A\n\ntesto\n\n### sub\n\nx\n\n## B\n\ny');
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('### sub');
    expect(out[1]).toMatch(/^## B/);
  });

  it('ignores headings inside code fences', () => {
    expect(splitMarkdownSections('# A\n\n```\n# no\n```\n')).toHaveLength(1);
  });

  it('keeps preamble before the first heading and drops empty input', () => {
    expect(splitMarkdownSections('intro\n\n# A\n\nb')).toHaveLength(2);
    expect(splitMarkdownSections('  \n\n')).toEqual([]);
  });

  it('splits an oversized section on blank lines', () => {
    const para = 'x'.repeat(1500);
    const out = splitMarkdownSections(`# A\n\n${[para, para, para, para].join('\n\n')}`);
    expect(out.length).toBeGreaterThan(1);
    for (const part of out) expect(part.length).toBeLessThanOrEqual(4100);
  });
});
