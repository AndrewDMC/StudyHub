import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VerifyActionBar } from '@/components/verify/VerifyActionBar';
import { verifyBarState } from '@/lib/verifyClient';

describe('verifyBarState', () => {
  it('has no bar on the outcome page (no question on screen)', () => {
    expect(verifyBarState({ hasItem: false, ended: false, answered: false })).toBe('none');
    expect(verifyBarState({ hasItem: false, ended: true, answered: true })).toBe('none');
  });

  it('an open question shows Correggi and Non me lo ricordo', () => {
    expect(verifyBarState({ hasItem: true, ended: false, answered: false })).toBe('open');
  });

  it('an answered question shows the way on', () => {
    expect(verifyBarState({ hasItem: true, ended: false, answered: true })).toBe('next');
  });

  it('a finished check only has the two arrows, answered or not', () => {
    expect(verifyBarState({ hasItem: true, ended: true, answered: true })).toBe('review');
    expect(verifyBarState({ hasItem: true, ended: true, answered: false })).toBe('review');
  });
});

describe('VerifyActionBar', () => {
  it('is a fixed toolbar with the safe area under it and a slot for the question', () => {
    const html = renderToStaticMarkup(createElement(VerifyActionBar, { setSlot: () => {} }));
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Azioni della verifica"');
    expect(html).toContain('fixed inset-x-0 bottom-0');
    expect(html).toContain('pb-[max(12px,env(safe-area-inset-bottom))]');
    expect(html).toContain('<div class="flex min-w-0 flex-1 items-center gap-2"></div>');
  });

  it('renders its children when there is no slot', () => {
    const html = renderToStaticMarkup(
      createElement(VerifyActionBar, null, createElement('button', { type: 'button' }, 'Avanti')),
    );
    expect(html).toContain('<button type="button">Avanti</button>');
    expect(html).not.toContain('flex min-w-0 flex-1 items-center gap-2');
  });
});
