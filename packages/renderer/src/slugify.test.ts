import { describe, expect, it } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases and replaces whitespace with underscore', () => {
    expect(slugify('John Doe')).toBe('john_doe');
    expect(slugify('Joy Poddar')).toBe('joy_poddar');
  });

  it('preserves dashes (invoice numbers like CRE-2026-0001)', () => {
    expect(slugify('CRE-2026-0001')).toBe('cre-2026-0001');
    expect(slugify('INV-2026-0042')).toBe('inv-2026-0042');
  });

  it('preserves dots', () => {
    expect(slugify('Acme, Inc.')).toBe('acme_inc.');
  });

  it('collapses runs of separators', () => {
    expect(slugify('Hello   World!!!')).toBe('hello_world');
    expect(slugify('a___b')).toBe('a_b');
  });

  it('trims leading and trailing underscores', () => {
    expect(slugify('  Trailing  ')).toBe('trailing');
    expect(slugify('___weird___')).toBe('weird');
  });

  it('strips non-ASCII letters (Intl users get a degraded but valid filename)', () => {
    expect(slugify('Café Müller')).toBe('caf_m_ller');
  });

  it('returns empty string for whitespace-only or empty input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('keeps digits', () => {
    expect(slugify('Customer 42')).toBe('customer_42');
  });
});
