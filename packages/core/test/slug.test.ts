import { describe, expect, it } from 'vitest';
import { disambiguateSlug, isValidSlug, slugify } from '../src/slug.js';

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('Fisica 1')).toBe('fisica-1');
  });

  it('strips diacritics instead of dropping them', () => {
    expect(slugify('Analisi Matematica è Cristallografia')).toBe(
      'analisi-matematica-e-cristallografia',
    );
  });

  it('handles unicode / emoji / symbols by collapsing to dashes', () => {
    expect(slugify('日本語 🎌 Física & Química')).toBe('fisica-quimica');
  });

  it('collapses repeated separators and trims edges', () => {
    expect(slugify('  --Analisi   1--  ')).toBe('analisi-1');
  });

  it('falls back to "subject" when nothing alphanumeric survives', () => {
    expect(slugify('!!!')).toBe('subject');
    expect(slugify('')).toBe('subject');
  });

  it('rewrites Windows reserved device names', () => {
    expect(slugify('CON')).toBe('con-subject');
    expect(slugify('nul')).toBe('nul-subject');
    expect(slugify('LPT1')).toBe('lpt1-subject');
  });

  it('truncates very long names', () => {
    const long = 'a'.repeat(200);
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(64);
  });

  it('never produces a trailing dash after truncation', () => {
    const input = `${'a'.repeat(63)} b`;
    expect(slugify(input).endsWith('-')).toBe(false);
  });
});

describe('isValidSlug', () => {
  it('accepts well-formed slugs', () => {
    expect(isValidSlug('fisica-1')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
  });

  it('rejects empty, uppercase, spaces, traversal, and reserved names', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('Fisica')).toBe(false);
    expect(isValidSlug('fisica 1')).toBe(false);
    expect(isValidSlug('..')).toBe(false);
    expect(isValidSlug('../etc')).toBe(false);
    expect(isValidSlug('con')).toBe(false);
    expect(isValidSlug('-fisica')).toBe(false);
    expect(isValidSlug('fisica-')).toBe(false);
    expect(isValidSlug('fisica--1')).toBe(false);
  });
});

describe('disambiguateSlug', () => {
  it('returns the base slug when free', () => {
    expect(disambiguateSlug('fisica-1', new Set())).toBe('fisica-1');
  });

  it('appends -2, -3, ... until free', () => {
    const taken = new Set(['fisica-1', 'fisica-1-2', 'fisica-1-3']);
    expect(disambiguateSlug('fisica-1', taken)).toBe('fisica-1-4');
  });
});
