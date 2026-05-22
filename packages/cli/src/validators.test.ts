import { describe, expect, it } from 'vitest';
import { validateEmail, validateEmailList, validateIfsc } from './validators.js';

describe('validateEmail', () => {
  it('accepts a well-formed email', () => {
    expect(validateEmail()('a@b.com')).toBe(true);
    expect(validateEmail()('joy+billing@creowis.co.in')).toBe(true);
  });

  it('rejects malformed emails', () => {
    expect(validateEmail()('not-an-email')).toMatch(/doesn't look like/);
    expect(validateEmail()('a@b')).toMatch(/doesn't look like/);
    expect(validateEmail()('@b.com')).toMatch(/doesn't look like/);
  });

  it('rejects empty by default', () => {
    expect(validateEmail()('')).toBe('Email is required.');
  });

  it('accepts empty when allowEmpty=true', () => {
    expect(validateEmail(true)('')).toBe(true);
    expect(validateEmail(true)('   ')).toBe(true);
  });
});

describe('validateEmailList', () => {
  it('accepts a single valid email', () => {
    expect(validateEmailList()('a@b.com')).toBe(true);
  });

  it('accepts multiple valid emails separated by commas + whitespace', () => {
    expect(validateEmailList()('a@b.com, c@d.com,e@f.com')).toBe(true);
  });

  it('rejects a list with one bad entry', () => {
    expect(validateEmailList()('a@b.com, not-an-email, c@d.com')).toMatch(/doesn't look like/);
  });

  it('rejects empty by default', () => {
    expect(validateEmailList()('')).toBe('At least one email is required.');
    expect(validateEmailList()(',,, ,')).toBe('At least one email is required.');
  });

  it('accepts empty when allowEmpty=true', () => {
    expect(validateEmailList(true)('')).toBe(true);
  });
});

describe('validateIfsc', () => {
  it('accepts a canonical IFSC', () => {
    expect(validateIfsc()('HDFC0001234')).toBe(true);
    expect(validateIfsc()('SBIN0042001')).toBe(true);
  });

  it('accepts lowercase by uppercasing internally', () => {
    expect(validateIfsc()('hdfc0001234')).toBe(true);
  });

  it('rejects out-of-format strings', () => {
    expect(validateIfsc()('1234')).toMatch(/should be 11 chars/);
    expect(validateIfsc()('HDFC1001234')).toMatch(/should be 11 chars/); // missing '0' at position 5
    expect(validateIfsc()('HDFC000123')).toMatch(/should be 11 chars/); // too short
  });

  it('accepts empty by default (IFSC is optional in setup)', () => {
    expect(validateIfsc()('')).toBe(true);
  });

  it('rejects empty when allowEmpty=false', () => {
    expect(validateIfsc(false)('')).toBe('IFSC is required.');
  });
});
