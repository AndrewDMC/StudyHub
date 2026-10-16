import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ATTEMPT_PHOTO_MAX_BYTES } from '@studyhub/core/browser';
import { MODEL_OPTIONS, modelLabel } from '../src/components/ModelPicker';
import { canPassThrough, fitWithin, PHOTO_PASSTHROUGH_MAX_BYTES } from '../src/lib/photoCompress';
import { answeredCount, attemptVerdict, photoTranscriptNote } from '../src/lib/simulationMobile';
import { formatRecurringTopic } from '../src/lib/format';
import { PHOTO_ERRORS, PHOTO_RAW_MAX_BYTES, validatePhotoFile } from '../src/lib/useAttemptPhotos';

describe('attemptVerdict', () => {
  it('0.6 esatto è Sufficiente', () => {
    expect(attemptVerdict(18, 30)).toBe('pass');
    expect(attemptVerdict(3, 5)).toBe('pass');
  });
  it('sotto la soglia è Insufficiente', () => {
    expect(attemptVerdict(17, 30)).toBe('fail');
    expect(attemptVerdict(0, 10)).toBe('fail');
  });
  it('punteggio pieno è Sufficiente', () => {
    expect(attemptVerdict(30, 30)).toBe('pass');
  });
  it('tentativo non corretto: nessun verdetto', () => {
    expect(attemptVerdict(null, 30)).toBeNull();
    expect(attemptVerdict(10, null)).toBeNull();
    expect(attemptVerdict(null, null)).toBeNull();
    expect(attemptVerdict(0, 0)).toBeNull();
  });
});

describe('formatRecurringTopic', () => {
  it('con il conteggio aggiunge ×N', () => {
    expect(formatRecurringTopic({ name: 'Integrali', count: 6 })).toBe('Integrali ×6');
  });
  it('con count null mostra solo il nome', () => {
    expect(formatRecurringTopic({ name: 'Integrali', count: null })).toBe('Integrali');
  });
});

describe('answeredCount con foto', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('un esercizio con sole foto conta come risposto', () => {
    expect(answeredCount(items, {}, { b: 2 })).toBe(1);
  });
  it('testo e foto sullo stesso esercizio contano una volta', () => {
    expect(answeredCount(items, { a: 'x', b: '  ' }, { a: 1, b: 1, c: 0 })).toBe(2);
  });
  it('senza foto vale solo il testo', () => {
    expect(answeredCount(items, { a: 'x' })).toBe(1);
  });
});

describe('validatePhotoFile', () => {
  it('accetta jpeg, png, webp e heic/heif (decodificati dal browser prima dell’invio)', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(validatePhotoFile({ size: 1000, type })).toBeNull();
    }
  });
  it('accetta il tipo vuoto (il server resta l’autorità)', () => {
    expect(validatePhotoFile({ size: 1000, type: '' })).toBeNull();
  });
  it('rifiuta i file che non sono immagini supportate', () => {
    expect(validatePhotoFile({ size: 1000, type: 'application/pdf' })).toBe(PHOTO_ERRORS.format);
    expect(validatePhotoFile({ size: 1000, type: 'image/gif' })).toBe(PHOTO_ERRORS.format);
  });
  it('un originale da telefono oltre il limite del server passa (si comprime), oltre 30 MB no', () => {
    expect(validatePhotoFile({ size: ATTEMPT_PHOTO_MAX_BYTES + 1, type: 'image/jpeg' })).toBeNull();
    expect(validatePhotoFile({ size: PHOTO_RAW_MAX_BYTES, type: 'image/jpeg' })).toBeNull();
    expect(validatePhotoFile({ size: PHOTO_RAW_MAX_BYTES + 1, type: 'image/jpeg' })).toBe(
      PHOTO_ERRORS.size,
    );
  });
  it('i messaggi non citano più 10 MB né HEIC', () => {
    expect(PHOTO_ERRORS.format).toBe('Formato non supportato: usa JPEG o PNG.');
    expect(JSON.stringify(PHOTO_ERRORS)).not.toMatch(/10 MB|HEIC/);
  });
});

describe('canPassThrough', () => {
  it('fino a 3,5 MB si invia così com’è, oltre si ricomprime', () => {
    expect(canPassThrough(PHOTO_PASSTHROUGH_MAX_BYTES)).toBe(true);
    expect(canPassThrough(PHOTO_PASSTHROUGH_MAX_BYTES + 1)).toBe(false);
    expect(PHOTO_PASSTHROUGH_MAX_BYTES).toBeLessThan(ATTEMPT_PHOTO_MAX_BYTES);
  });
});

describe('fitWithin', () => {
  it('non ingrandisce e non tocca le immagini piccole', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2048, 1000)).toEqual({ width: 2048, height: 1000 });
  });
  it('porta il lato lungo a 2048 mantenendo le proporzioni', () => {
    expect(fitWithin(4096, 3072)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1536, height: 2048 });
  });
  it('mai sotto 1 px', () => {
    expect(fitWithin(100000, 10)).toEqual({ width: 2048, height: 1 });
  });
});

describe('photoTranscriptNote', () => {
  const p = (transcriptStatus: 'ok' | 'illegible' | 'failed' | null) => ({ transcriptStatus });
  it('senza foto nessuna frase', () => {
    expect(photoTranscriptNote([])).toBeNull();
  });
  it('tutte ok: frase di trascrizione', () => {
    expect(photoTranscriptNote([p('ok'), p('ok')])?.kind).toBe('ok');
  });
  it('con foto illeggibili o fallite: conta quante e rimanda al testo scritto', () => {
    expect(photoTranscriptNote([p('ok'), p('illegible'), p('failed')])).toEqual({
      kind: 'unreadable',
      text: 'Non è stato possibile leggere 2 foto: la correzione si basa sul testo scritto.',
    });
  });
  it('non ancora trascritte: nessuna frase', () => {
    expect(photoTranscriptNote([p('ok'), p(null)])).toBeNull();
  });
});

describe('etichette "(default)" dei modelli', () => {
  const labelOf = (id: string, defaultId: string) =>
    modelLabel(
      MODEL_OPTIONS.find((m) => m.id === id)!,
      defaultId,
    );
  it('il default reale del contesto ha il suffisso, gli altri no', () => {
    const [haiku, sonnet, opus] = MODEL_OPTIONS;
    expect(modelLabel(opus, opus.id)).toMatch(/\(default\)$/); // ExamPrepPanel
    expect(modelLabel(sonnet, sonnet.id)).toMatch(/\(default\)$/); // GenerationPanel, SessionBriefing
    expect(modelLabel(haiku, haiku.id)).toMatch(/\(default\)$/); // chat, TopicsPanel
    expect(labelOf(sonnet.id, opus.id)).not.toMatch(/default/);
    expect(labelOf(haiku.id, sonnet.id)).not.toMatch(/default/);
    expect(modelLabel(haiku)).not.toMatch(/default/);
  });
  it('i pannelli passano il defaultId corretto a ModelPicker', () => {
    const src = (f: string) => readFileSync(join(__dirname, '../src/components', f), 'utf8');
    const idx = (f: string) => /defaultId=\{MODEL_OPTIONS\[(\d)\]\.id\}/.exec(src(f))?.[1];
    expect(idx('ExamPrepPanel.tsx')).toBe('2');
    expect(idx('GenerationPanel.tsx')).toBe('1');
    expect(idx('SessionBriefing.tsx')).toBe('1');
    expect(idx('SessionChat.tsx')).toBe('0');
    expect(idx('TopicsPanel.tsx')).toBe('0');
  });
});
