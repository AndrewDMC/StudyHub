import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ObsidianMarkdown } from '../src/components/ObsidianMarkdown';
import { resolveWikilink, splitFrontmatter } from '../src/lib/obsidianMarkdown';

const render = (source: string) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ObsidianMarkdown, { source }),
    ),
  );

describe('splitFrontmatter', () => {
  it('separates YAML properties from the body', () => {
    const { properties, body } = splitFrontmatter('---\ntitle: Analisi\ntags: [a, b]\n---\n# Ciao');
    expect(properties).toEqual([
      ['title', 'Analisi'],
      ['tags', 'a, b'],
    ]);
    expect(body).toBe('# Ciao');
  });
  it('leaves notes without frontmatter untouched', () => {
    expect(splitFrontmatter('# Solo titolo').body).toBe('# Solo titolo');
  });
});

describe('ObsidianMarkdown', () => {
  it('renders callouts with type and title', () => {
    const html = render('> [!warning] Attenzione\n> contenuto');
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain('md-callout-title');
    expect(html).toContain('Attenzione');
    expect(html).not.toContain('[!warning]');
  });
  it('renders wikilinks (alias wins), highlights and tags', () => {
    const html = render('Vedi [[Limiti|i limiti]] e ==importante== #analisi/1');
    expect(html).toContain('md-wikilink md-unresolved');
    expect(html).toContain('i limiti');
    expect(html).toContain('<mark>importante</mark>');
    expect(html).toContain('md-tag');
  });
  it('renders math, tables and task lists', () => {
    const html = render('$x^2$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] fatto');
    expect(html).toContain('katex');
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
  });
});

describe('resolveWikilink', () => {
  const docs = [{ originalName: 'Analisi 1.md' }, { originalName: 'Fisica.pdf' }];
  it('matches by name ignoring case, folder, extension and anchor', () => {
    expect(resolveWikilink('analisi 1', docs)).toBe(docs[0]);
    expect(resolveWikilink('Corsi/Fisica#Cinematica', docs)).toBe(docs[1]);
    expect(resolveWikilink('Fisica.pdf', docs)).toBe(docs[1]);
  });
  it('returns null when nothing matches', () => {
    expect(resolveWikilink('Chimica', docs)).toBeNull();
    expect(resolveWikilink('#solo-anchor', docs)).toBeNull();
  });
});
