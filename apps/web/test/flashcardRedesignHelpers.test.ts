import type { CalibrationDto, DeckSummaryDto } from '@studyhub/contracts';
import { describe, expect, it } from 'vitest';
import { cardActions, exclusionReason } from '../src/components/flashcards/shared/cardActions';
import { deckActions } from '../src/components/flashcards/shared/deckActions';
import { CALIBRATION_LEVEL_LABELS, headline, pct, verdictTail } from '../src/lib/calibrationText';

const calibration = (over: Partial<CalibrationDto>): CalibrationDto => ({
  total: 100,
  levels: [],
  illusionRate: null,
  hiddenKnowledgeRate: null,
  bias: null,
  verdict: 'insufficient_data',
  minSamplesPerLevel: 10,
  illusionByTopic: [],
  ...over,
});

describe('calibrationText', () => {
  it('formatta le percentuali e i livelli di fiducia', () => {
    expect(pct(0.184)).toBe('18%');
    expect(pct(1)).toBe('100%');
    expect(CALIBRATION_LEVEL_LABELS).toEqual({ 1: 'Non lo so', 2: 'Forse', 3: 'Lo so' });
  });

  it('una frase per ogni verdetto, con lo scarto in punti', () => {
    expect(headline(calibration({ verdict: 'overconfident', bias: 0.18 }))).toContain(
      'scarto 18 punti',
    );
    expect(headline(calibration({ verdict: 'underconfident', bias: -0.12 }))).toContain(
      'scarto 12 punti',
    );
    expect(headline(calibration({ verdict: 'calibrated' }))).toContain('ben calibrato');
    expect(
      headline(calibration({ verdict: 'insufficient_data', minSamplesPerLevel: 7 })),
    ).toContain('almeno 7 per livello');
  });

  it('la coda della frase manca quando i dati non bastano', () => {
    expect(verdictTail(calibration({ verdict: 'overconfident' }))).toBe(
      "tendi a sopravvalutarti un po'.",
    );
    expect(verdictTail(calibration({ verdict: 'underconfident' }))).toBe('tendi a sottovalutarti.');
    expect(verdictTail(calibration({ verdict: 'calibrated' }))).toBe('sei comunque ben calibrato.');
    expect(verdictTail(calibration({ verdict: 'insufficient_data' }))).toBeNull();
  });
});

describe('cardActions / exclusionReason', () => {
  it('"Rimetti nel ripasso" compare solo per le segnalate, Elimina è sempre ultima e pericolosa', () => {
    const plain = cardActions({ flaggedAt: null, suspended: false });
    expect(plain.map((a) => a.id)).toEqual(['suspend', 'move', 'topic', 'delete']);
    const flagged = cardActions({ flaggedAt: '2026-06-10T00:00:00.000Z', suspended: false });
    expect(flagged[0]).toMatchObject({ id: 'unflag', label: 'Rimetti nel ripasso' });
    const last = plain.at(-1)!;
    expect(last).toMatchObject({ id: 'delete', tone: 'danger', separatorBefore: true });
  });

  it('una sospesa offre Riattiva al posto di Sospendi', () => {
    const ids = cardActions({ flaggedAt: null, suspended: true }).map((a) => a.id);
    expect(ids).toContain('unsuspend');
    expect(ids).not.toContain('suspend');
  });

  it('il motivo di esclusione ha priorità: segnalata, sospesa, mazzo non approvato', () => {
    const flagged = '2026-06-10T00:00:00.000Z';
    expect(exclusionReason({ flaggedAt: flagged, suspended: true }, 'draft')).toBe('flagged');
    expect(exclusionReason({ flaggedAt: null, suspended: true }, 'draft')).toBe('suspended');
    expect(exclusionReason({ flaggedAt: null, suspended: false }, 'draft')).toBe('deck');
    expect(exclusionReason({ flaggedAt: null, suspended: false }, 'archived')).toBe('deck');
    expect(exclusionReason({ flaggedAt: null, suspended: false }, 'approved')).toBeNull();
    expect(exclusionReason({ flaggedAt: null, suspended: false }, undefined)).toBeNull();
  });
});

describe('deckActions', () => {
  const deck = { id: 'deck-1', title: 'Fisica' } as DeckSummaryDto;

  it('menu in ordine, con gli export come link ai file del mazzo', () => {
    const actions = deckActions('fisica', deck);
    expect(actions.map((a) => a.label)).toEqual([
      'Rinomina',
      'Unisci in un altro mazzo…',
      'Per Anki (.apkg)',
      'Foglio CSV',
      'Archivia mazzo',
    ]);
    expect(actions.find((a) => a.id === 'export-apkg')?.href).toBe(
      '/api/subjects/fisica/artifacts/deck-1/export.apkg',
    );
    expect(actions.find((a) => a.id === 'export-csv')?.href).toBe(
      '/api/subjects/fisica/artifacts/deck-1/export.csv',
    );
    expect(actions.find((a) => a.id === 'rename')?.href).toBeUndefined();
  });

  it('Archivia è l’ultima voce, pericolosa e separata', () => {
    expect(deckActions('fisica', deck).at(-1)).toMatchObject({
      id: 'archive',
      tone: 'danger',
      separatorBefore: true,
    });
  });
});
