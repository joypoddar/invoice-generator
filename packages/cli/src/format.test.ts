import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDate, formatPercent } from './format.js';

describe('formatDate', () => {
  const iso = '2026-05-17';

  it('defaults to DD/MM/YYYY', () => {
    expect(formatDate(iso)).toBe('17/05/2026');
  });

  it('supports DD/MM/YYYY explicitly', () => {
    expect(formatDate(iso, 'DD/MM/YYYY')).toBe('17/05/2026');
  });

  it('supports YYYY-MM-DD', () => {
    expect(formatDate(iso, 'YYYY-MM-DD')).toBe('2026-05-17');
  });

  it('supports MM/DD/YYYY', () => {
    expect(formatDate(iso, 'MM/DD/YYYY')).toBe('05/17/2026');
  });

  it('supports DD-MM-YYYY', () => {
    expect(formatDate(iso, 'DD-MM-YYYY')).toBe('17-05-2026');
  });

  it('zero-pads single-digit months and days', () => {
    expect(formatDate('2026-01-05', 'DD/MM/YYYY')).toBe('05/01/2026');
  });

  it('returns empty string for undefined', () => {
    expect(formatDate(undefined)).toBe('');
  });

  it('returns the input for unparseable dates', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('falls back to DD/MM/YYYY for unknown formats', () => {
    expect(formatDate(iso, 'BOGUS')).toBe('17/05/2026');
  });
});

describe('formatCurrency', () => {
  it('uses Indian comma-grouping for INR (lakhs)', () => {
    // 1,234,567.89 in INR style is 12,34,567.89 (lakhs)
    const out = formatCurrency(1234567.89, 'INR');
    expect(out).toContain('12,34,567.89');
    // Symbol depends on locale data — both ₹ and "INR" prefixes are acceptable
    expect(out).toMatch(/[₹]|INR/);
  });

  it('uses Western grouping for USD', () => {
    const out = formatCurrency(12345.67, 'USD');
    expect(out).toContain('12,345.67');
    expect(out).toMatch(/\$/);
  });

  it('falls back to ISO code when currency is unknown', () => {
    // Most Intl implementations DO support arbitrary 3-letter codes; this
    // exercises the manual fallback path with an obviously invalid code.
    const out = formatCurrency(100, 'XYZ-INVALID');
    expect(out).toContain('100.00');
  });

  it('handles zero and negative amounts', () => {
    expect(formatCurrency(0, 'USD')).toContain('0.00');
    expect(formatCurrency(-50, 'USD')).toMatch(/-?\$50\.00|\$\(50\.00\)|\(\$50\.00\)/);
  });

  it('always shows 2 fractional digits', () => {
    expect(formatCurrency(100, 'INR')).toContain('100.00');
    expect(formatCurrency(99.5, 'INR')).toContain('99.50');
  });
});

describe('formatPercent', () => {
  it('formats integer percentages without decimals', () => {
    expect(formatPercent(0.18)).toBe('18%');
    expect(formatPercent(0.05)).toBe('5%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('formats fractional percentages with 1 decimal', () => {
    expect(formatPercent(0.075)).toBe('7.5%');
    expect(formatPercent(0.125)).toBe('12.5%');
  });

  it('handles zero', () => {
    expect(formatPercent(0)).toBe('0%');
  });
});
