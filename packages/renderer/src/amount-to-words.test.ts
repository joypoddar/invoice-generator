import { describe, expect, it } from 'vitest';
import { amountToWords } from './amount-to-words.js';

describe('amountToWords', () => {
  it('matches the reference design (186 INR)', () => {
    expect(amountToWords(186, 'INR')).toBe('Rupees One hundred and eighty six only.');
  });

  it('handles zero', () => {
    expect(amountToWords(0, 'INR')).toBe('Rupees Zero only.');
  });

  it('handles paise', () => {
    expect(amountToWords(186.5, 'INR')).toBe('Rupees One hundred and eighty six and fifty paise only.');
    expect(amountToWords(1.05, 'INR')).toBe('Rupees One and five paise only.');
  });

  it('uses the Indian numbering system (lakh/crore)', () => {
    expect(amountToWords(100000, 'INR')).toBe('Rupees One lakh only.');
    expect(amountToWords(2500000, 'INR')).toBe('Rupees Twenty five lakh only.');
    expect(amountToWords(12345678, 'INR')).toBe(
      'Rupees One crore twenty three lakh forty five thousand six hundred and seventy eight only.',
    );
  });

  it('handles teens and round tens', () => {
    expect(amountToWords(15, 'INR')).toBe('Rupees Fifteen only.');
    expect(amountToWords(40, 'INR')).toBe('Rupees Forty only.');
    expect(amountToWords(1000, 'INR')).toBe('Rupees One thousand only.');
  });

  it('maps other currencies', () => {
    expect(amountToWords(5, 'USD')).toBe('Dollars Five only.');
    expect(amountToWords(2.5, 'GBP')).toBe('Pounds Two and fifty pence only.');
  });

  it('falls back to the currency code for unknown currencies', () => {
    expect(amountToWords(3, 'XYZ')).toBe('XYZ Three only.');
  });
});
