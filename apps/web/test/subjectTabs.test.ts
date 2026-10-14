import { describe, expect, it } from 'vitest';
import { parseSubjectTab, tabLinks, materialHref } from '../src/lib/subjectTabs';

const parse = (qs: string) => parseSubjectTab(new URLSearchParams(qs));

describe('parseSubjectTab', () => {
  it('defaults to panoramica for missing or unknown values', () => {
    expect(parse('').tab).toBe('panoramica');
    expect(parse('tab=boh').tab).toBe('panoramica');
  });

  it('maps legacy document tabs to Materiale with the matching filter', () => {
    for (const f of ['appunti', 'schemi', 'esami', 'altro']) {
      expect(parse(`tab=${f}`)).toEqual({ tab: 'materiale', filter: f });
    }
  });

  it('reads ?filtro= only on materiale and ignores invalid values', () => {
    expect(parse('tab=materiale&filtro=schemi')).toEqual({ tab: 'materiale', filter: 'schemi' });
    expect(parse('tab=materiale&filtro=x')).toEqual({ tab: 'materiale', filter: 'tutti' });
    expect(parse('tab=materiale')).toEqual({ tab: 'materiale', filter: 'tutti' });
  });

  it('keeps flashcard, simulazioni and lacune', () => {
    expect(parse('tab=lacune').tab).toBe('lacune');
    expect(parse('tab=flashcard').tab).toBe('flashcard');
    expect(parse('tab=simulazioni').tab).toBe('simulazioni');
  });
});

describe('tabLinks / materialHref', () => {
  it('lists six tabs ending with the plan page', () => {
    const links = tabLinks('analisi');
    expect(links.map((l) => l.label)).toEqual([
      'Panoramica',
      'Materiale',
      'Flashcard',
      'Simulazioni',
      'Lacune',
      'Piano',
    ]);
    expect(links[5]!.href).toBe('/materie/analisi/piano');
    expect(links[0]!.href).toBe('/materie/analisi');
  });

  it('omits filtro for tutti', () => {
    expect(materialHref('a', 'tutti')).toBe('/materie/a?tab=materiale');
    expect(materialHref('a', 'esami')).toBe('/materie/a?tab=materiale&filtro=esami');
  });
});
