import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VerifyItemDto, VerifyStateDto, VerifySummaryDto } from '@studyhub/contracts';
import { KeyPointDisclosure } from '@/components/verify/KeyPointDisclosure';
import { VerifyHeader } from '@/components/verify/VerifyHeader';
import { VerifyOutcome } from '@/components/verify/VerifyOutcome';
import { VerifyProgress } from '@/components/verify/VerifyProgress';
import { VerifyQuestionCard } from '@/components/verify/VerifyQuestionCard';
import { VerifySummary } from '@/components/verify/VerifySummary';
import { nextOpenIndex } from '@/components/verify/VerifyClient';
import {
  allAnswered,
  canRetry,
  currentIndex,
  formatVerifyDate,
  masteryPercent,
  outcomeOf,
  progressGridClass,
  shouldPollVerify,
  showSummary,
  verifyMode,
} from '@/lib/verifyClient';

const ID = '00000000-0000-4000-8000-000000000001';

function item(over: Partial<VerifyItemDto> = {}): VerifyItemDto {
  return {
    id: ID,
    kind: 'exercise',
    orderIndex: 0,
    question: 'Calcola la derivata di x^2',
    state: 'open',
    studentAnswer: null,
    feedback: null,
    keyPoint: null,
    originLessonTitle: null,
    ...over,
  };
}
function summary(over: Partial<VerifySummaryDto> = {}): VerifySummaryDto {
  return {
    correct: 2,
    total: 3,
    unstable: ['Regola della catena'],
    nextVerifyDate: '2026-11-02',
    masteryBefore: 0.4,
    masteryNow: 0.55,
    ...over,
  };
}
function state(over: Partial<VerifyStateDto> = {}): VerifyStateDto {
  return {
    prepared: true,
    ended: false,
    subjectName: 'Analisi',
    topicName: 'Derivate',
    daysOffset: 3,
    items: [item(), item({ id: ID.replace(/1$/, '2') })],
    job: null,
    summary: null,
    costEur: 0,
    ...over,
  };
}
const noop = () => {};

describe('verify helpers', () => {
  it('turns a half-scored wrong into "partial"', () => {
    expect(outcomeOf({ state: 'wrong', feedback: { verdict: 'partial', text: '' } })).toBe(
      'partial',
    );
    expect(outcomeOf({ state: 'wrong', feedback: { verdict: 'wrong', text: '' } })).toBe('wrong');
    expect(outcomeOf({ state: 'unknown', feedback: null })).toBe('unknown');
  });

  it('finds the first open question and the next open one', () => {
    const items: Pick<VerifyItemDto, 'state'>[] = [
      { state: 'correct' },
      { state: 'open' },
      { state: 'wrong' },
      { state: 'open' },
    ];
    expect(currentIndex(items)).toBe(1);
    expect(nextOpenIndex(items, 1)).toBe(3);
    expect(nextOpenIndex(items, 3)).toBe(4);
    expect(currentIndex([{ state: 'wrong' }])).toBe(1);
    expect(allAnswered([])).toBe(false);
    expect(allAnswered([{ state: 'unknown' }])).toBe(true);
  });

  it('shows the summary only when every question has an outcome and the server sent it', () => {
    const done = [item({ state: 'correct' }), item({ state: 'unknown' })];
    expect(showSummary({ items: done, summary: summary() })).toBe(true);
    expect(showSummary({ items: done, summary: null })).toBe(false);
    expect(showSummary({ items: [item(), ...done], summary: summary() })).toBe(false);
    const running = { id: ID, status: 'running' as const, error: null };
    expect(showSummary({ items: done, summary: summary(), job: running })).toBe(false);
    expect(
      showSummary({ items: done, summary: summary(), job: { ...running, status: 'succeeded' } }),
    ).toBe(true);
  });

  it('offers "Rifalla" only with something not right on an open session', () => {
    expect(canRetry({ ended: false, summary: summary() })).toBe(true);
    expect(canRetry({ ended: true, summary: summary() })).toBe(false);
    expect(canRetry({ ended: false, summary: summary({ correct: 3 }) })).toBe(false);
    expect(canRetry({ ended: false, summary: null })).toBe(false);
  });

  it('classifies the page mode', () => {
    expect(verifyMode(undefined)).toBe('loading');
    expect(verifyMode(state({ prepared: false, items: [] }))).toBe('legacy');
    expect(verifyMode(state())).toBe('ready');
    const job = (status: 'queued' | 'failed') => ({ id: ID, status, error: null });
    expect(verifyMode(state({ items: [], job: job('queued') }))).toBe('preparing');
    expect(verifyMode(state({ items: [item()], job: job('queued') }))).toBe('ready');
    expect(verifyMode(state({ items: [], job: job('failed') }))).toBe('failed');
    expect(verifyMode(state({ items: [item()], job: job('failed') }))).toBe('ready');
    expect(verifyMode(state({ items: [] }))).toBe('empty');
  });

  it('polls only while the generation runs', () => {
    expect(shouldPollVerify(state({ job: { id: ID, status: 'running', error: null } }))).toBe(true);
    expect(shouldPollVerify(state({ job: { id: ID, status: 'succeeded', error: null } }))).toBe(
      false,
    );
    expect(shouldPollVerify(undefined)).toBe(false);
  });

  it('shows mastery as whole percents from a 0..1 scale', () => {
    expect(masteryPercent(0.456)).toBe(46);
    expect(masteryPercent(null)).toBeNull();
    expect(masteryPercent(1.4)).toBe(100);
  });

  it('formats the date without time-zone drift', () => {
    expect(formatVerifyDate('2026-11-02')).toBe('2 nov');
    expect(formatVerifyDate('boh')).toBe('boh');
  });

  it('uses static grid classes', () => {
    expect(progressGridClass(2)).toBe('grid-cols-2');
    expect(progressGridClass(3)).toBe('grid-cols-3');
  });
});

describe('verify components', () => {
  it('header: topic, offset badge and closed-book reminder', () => {
    const html = renderToStaticMarkup(
      createElement(VerifyHeader, {
        subjectName: 'Analisi',
        subjectHref: '/materie/analisi',
        topicName: 'Derivate',
        daysOffset: 7,
      }),
    );
    expect(html).toContain('Verifica · Derivate');
    expect(html).toContain('+7 giorni');
    expect(html).toContain('Materiale chiuso');
    expect(html).toContain('Torna alla materia Analisi');
  });

  it('progress: counter and label', () => {
    const html = renderToStaticMarkup(
      createElement(VerifyProgress, {
        items: [item({ state: 'correct' }), item(), item()],
        viewIndex: 1,
        done: false,
      }),
    );
    expect(html).toContain('Domanda 2 di 3');
    expect(html).toContain('2 / 3');
    expect(html).toContain('bg-ok');
    expect(html).toContain('bg-accent');
  });

  it('open question: no outcome, no key point, "Correggi" disabled while empty', () => {
    const html = renderToStaticMarkup(
      createElement(VerifyQuestionCard, {
        sessionId: ID,
        item: item({ keyPoint: null }),
        n: 1,
        total: 3,
        ended: false,
        busy: false,
        grading: false,
        error: null,
        nextLabel: 'Avanti →',
        onGrade: noop,
        onUnknown: noop,
        onNext: noop,
        onOpenCitation: noop,
      }),
    );
    expect(html).toContain('Domanda 1 di 3');
    expect(html).toContain('Esercizio');
    expect(html).toContain('Non me lo ricordo');
    expect(html).toContain('Scrivi prima una risposta');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Correggi/);
    expect(html).not.toContain('Riapri il punto chiave');
    expect(html).not.toContain('Avanti');
  });

  it('wrong answer: outcome, key point with citation and "Vedi l\'esito"', () => {
    const html = renderToStaticMarkup(
      createElement(VerifyQuestionCard, {
        sessionId: ID,
        item: item({
          state: 'wrong',
          studentAnswer: 'x',
          feedback: { verdict: 'wrong', text: 'Manca il fattore interno.' },
          keyPoint: {
            title: 'Regola della catena',
            body: 'Si deriva la funzione esterna.',
            citation: { docId: ID, documentName: 'Dispensa', page: 12, quote: 'catena' },
          },
        }),
        n: 3,
        total: 3,
        ended: false,
        busy: false,
        grading: false,
        error: null,
        nextLabel: 'Vedi l’esito →',
        onGrade: noop,
        onUnknown: noop,
        onNext: noop,
        onOpenCitation: noop,
      }),
    );
    expect(html).toContain('Sbagliato');
    expect(html).toContain('Manca il fattore interno.');
    expect(html).toContain('Riapri il punto chiave · Dispensa p. 12');
    expect(html).toContain('Regola della catena');
    expect(html).toContain('Vedi l’esito →');
    expect(html).not.toContain('>Correggi<');
  });

  it('ended session with an unanswered question: read-only, no actions', () => {
    const html = renderToStaticMarkup(
      createElement(VerifyQuestionCard, {
        sessionId: ID,
        item: item(),
        n: 1,
        total: 2,
        ended: true,
        busy: false,
        grading: false,
        error: null,
        nextLabel: null,
        onGrade: noop,
        onUnknown: noop,
        onNext: noop,
        onOpenCitation: noop,
      }),
    );
    expect(html).toContain('Non hai risposto a questa domanda.');
    expect(html).not.toContain('Correggi');
    expect(html).not.toContain('Non me lo ricordo');
  });

  it('budget error does not suggest typing again', () => {
    const html = renderToStaticMarkup(
      createElement(VerifyQuestionCard, {
        sessionId: ID,
        item: item(),
        n: 1,
        total: 2,
        ended: false,
        busy: false,
        grading: false,
        error: 'Budget AI giornaliero esaurito',
        nextLabel: null,
        onGrade: noop,
        onUnknown: noop,
        onNext: noop,
        onOpenCitation: noop,
      }),
    );
    expect(html).toContain('Hai raggiunto il budget AI di oggi');
  });

  it('outcome labels carry a sign, and "unknown" has a default text', () => {
    const unknown = renderToStaticMarkup(
      createElement(VerifyOutcome, { item: { state: 'unknown', feedback: null } }),
    );
    expect(unknown).toContain('Non te lo ricordavi');
    expect(unknown).toContain('?');
    expect(unknown).toContain('proprio questo');
    const partial = renderToStaticMarkup(
      createElement(VerifyOutcome, {
        item: { state: 'wrong', feedback: { verdict: 'partial', text: 'Quasi ci sei.' } },
      }),
    );
    expect(partial).toContain('Quasi');
    expect(partial).toContain('text-warn');
    expect(
      renderToStaticMarkup(
        createElement(VerifyOutcome, { item: { state: 'open', feedback: null } }),
      ),
    ).toBe('');
  });

  it('key point without citation says so', () => {
    const html = renderToStaticMarkup(
      createElement(KeyPointDisclosure, {
        itemId: ID,
        keyPoint: { title: 'T', body: 'corpo', citation: null },
        onOpenCitation: noop,
      }),
    );
    expect(html).toContain('Senza fonte');
    expect(html).toContain('aria-expanded="false"');
  });

  it('summary: N su M, unstable, next verify and mastery before → after', () => {
    const html = renderToStaticMarkup(
      createElement(VerifySummary, {
        summary: summary(),
        subjectHref: '/materie/analisi',
        topicName: 'Derivate',
        canRetry: true,
        retrying: false,
        onRetry: noop,
        retryError: null,
        closed: false,
        closing: false,
        closeError: null,
        onClose: noop,
        onBack: noop,
      }),
    );
    expect(html).toContain('2 su 3 senza aprire il materiale');
    expect(html).toContain('Regola della catena non è ancora stabile.');
    expect(html).toContain('Lo rimetto nella verifica del 2 nov.');
    expect(html).toContain('40% → 55%');
    expect(html).toContain('Torna alla materia');
    expect(html).toContain('Rifalla');
    expect(html).toContain('Chiudi la verifica');
  });

  it('summary: once the session is closed only the link back stays', () => {
    const html = renderToStaticMarkup(
      createElement(VerifySummary, {
        summary: summary(),
        subjectHref: '/materie/analisi',
        topicName: 'Derivate',
        canRetry: true,
        retrying: false,
        onRetry: noop,
        retryError: null,
        closed: true,
        closing: false,
        closeError: null,
        onClose: noop,
        onBack: noop,
      }),
    );
    expect(html).toContain('href="/materie/analisi"');
    expect(html).not.toContain('Chiudi la verifica');
    expect(html).not.toContain('Rifalla');
  });

  it('summary: all right, no next date, no mastery, no retry', () => {
    const html = renderToStaticMarkup(
      createElement(VerifySummary, {
        summary: summary({
          correct: 3,
          unstable: [],
          nextVerifyDate: null,
          masteryBefore: null,
          masteryNow: null,
        }),
        subjectHref: '/materie/analisi',
        topicName: 'Derivate',
        canRetry: false,
        retrying: false,
        onRetry: noop,
        retryError: null,
        closed: false,
        closing: false,
        closeError: null,
        onClose: noop,
        onBack: noop,
      }),
    );
    expect(html).toContain('3 su 3');
    expect(html).toContain('Tutto stabile');
    expect(html).not.toContain('prossima verifica');
    expect(html).not.toContain('Padronanza');
    expect(html).not.toContain('Rifalla');
  });

  it('summary: unstable without a next verify omits the sentence', () => {
    const html = renderToStaticMarkup(
      createElement(VerifySummary, {
        summary: summary({ unstable: ['A', 'B'], nextVerifyDate: null }),
        subjectHref: '/materie/analisi',
        topicName: null,
        canRetry: false,
        retrying: false,
        onRetry: noop,
        retryError: null,
        closed: false,
        closing: false,
        closeError: null,
        onClose: noop,
        onBack: noop,
      }),
    );
    expect(html).toContain('Non sono ancora stabili:');
    expect(html).not.toContain('nella verifica del');
  });
});
