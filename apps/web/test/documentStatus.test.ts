import { describe, expect, it } from 'vitest';
import {
  documentStatusView,
  documentTypeLabel,
  formatDocDate,
  formatDuration,
} from '../src/lib/documentStatus';
import { materialFilterForType } from '../src/lib/subjectTabs';

const base = {
  id: 'd1',
  status: 'parsed' as const,
  type: 'appunti' as const,
  mdPath: 'content.md' as string | null,
  mdConflict: false,
  blockedBlocks: 0,
  verificationStatus: 'not_required' as const,
};

describe('documentStatusView', () => {
  it('maps non-parsed statuses to the document screen', () => {
    for (const [status, label] of [
      ['missing', 'Mancante'],
      ['failed', 'Errore'],
      ['uploaded', 'Caricato'],
      ['parsing', 'Estrazione…'],
    ] as const) {
      const v = documentStatusView({ ...base, status });
      expect(v.label).toBe(label);
      expect(v.href('m')).toBe('/materie/m/documenti/d1');
    }
  });

  it('flags conflicts before anything else on parsed documents', () => {
    expect(documentStatusView({ ...base, mdConflict: true, type: 'schemi' }).key).toBe('conflict');
  });

  it('sends schemas with unverified blocks to Verifica', () => {
    const v = documentStatusView({
      ...base,
      type: 'schemi',
      blockedBlocks: 2,
      verificationStatus: 'partial',
    });
    expect(v.label).toBe('Da verificare');
    expect(v.href('m')).toBe('/materie/m/documenti/d1/verifica');
  });

  it('opens ready notes on the text and everything else on the original', () => {
    expect(documentStatusView(base).href('m')).toBe('/materie/m/documenti/d1');
    expect(documentStatusView({ ...base, type: 'esami', mdPath: null }).href('m')).toBe(
      '/materie/m/documenti/d1/originale',
    );
    expect(
      documentStatusView({ ...base, type: 'schemi', verificationStatus: 'verified' }).href('m'),
    ).toBe('/materie/m/documenti/d1/originale');
    expect(documentStatusView({ ...base, mdPath: null }).key).toBe('ready-original');
  });
});

describe('documentTypeLabel', () => {
  it('distinguishes hand-drawn schemas by mime', () => {
    expect(documentTypeLabel({ type: 'schemi', mime: 'image/png' })).toBe('Schema a mano');
    expect(documentTypeLabel({ type: 'esami', mime: 'application/pdf' })).toBe('Esame passato');
    expect(documentTypeLabel({ type: 'slide', mime: 'application/pdf' })).toBe('Slide');
  });
});

describe('materialFilterForType', () => {
  it('folds slide into altro', () => {
    expect(materialFilterForType('slide')).toBe('altro');
    expect(materialFilterForType('altro')).toBe('altro');
    expect(materialFilterForType('schemi')).toBe('schemi');
  });
});

describe('formatDocDate', () => {
  const now = new Date(2026, 9, 15, 12, 0);
  const daysAgo = (n: number) => new Date(2026, 9, 15 - n, 9, 0).toISOString();
  it('uses relative labels then a date', () => {
    expect(formatDocDate(daysAgo(0), now)).toBe('oggi');
    expect(formatDocDate(daysAgo(1), now)).toBe('ieri');
    expect(formatDocDate(daysAgo(3), now)).toBe('3 giorni fa');
    expect(formatDocDate(daysAgo(7), now)).toBe('1 settimana fa');
    expect(formatDocDate(daysAgo(15), now)).toBe('2 settimane fa');
    expect(formatDocDate(daysAgo(60), now)).toMatch(/2026/);
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 ora');
    expect(formatDuration(180)).toBe('3 ore');
    expect(formatDuration(90)).toBe('1 h 30 min');
  });
});
