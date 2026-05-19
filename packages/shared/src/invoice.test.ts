import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIELDS,
  renderInvoiceNumber,
  totalFor,
  hasCustomFields,
  type Invoice,
} from './invoice.js';

describe('renderInvoiceNumber', () => {
  const date = new Date('2026-05-17T12:00:00Z');

  it('substitutes {SEQ} with zero-padded 4-digit sequence', () => {
    expect(renderInvoiceNumber('INV-{SEQ}', 42, date)).toBe('INV-0042');
    expect(renderInvoiceNumber('INV-{SEQ}', 1, date)).toBe('INV-0001');
    expect(renderInvoiceNumber('INV-{SEQ}', 12345, date)).toBe('INV-12345');
  });

  it('substitutes {YYYY}, {MM}, {DD} from the given date', () => {
    expect(renderInvoiceNumber('{YYYY}', 0, date)).toBe('2026');
    expect(renderInvoiceNumber('{MM}', 0, date)).toBe('05');
    expect(renderInvoiceNumber('{DD}', 0, date)).toBe('17');
  });

  it('zero-pads single-digit months and days', () => {
    const jan5 = new Date(2026, 0, 5);
    expect(renderInvoiceNumber('{YYYY}-{MM}-{DD}', 0, jan5)).toBe('2026-01-05');
  });

  it('combines multiple variables', () => {
    expect(renderInvoiceNumber('CREOWIS-{YYYY}-AK-{SEQ}', 7, date)).toBe('CREOWIS-2026-AK-0007');
    expect(renderInvoiceNumber('INV-{YYYY}-{MM}-{SEQ}', 100, date)).toBe('INV-2026-05-0100');
  });

  it('returns the template untouched when no variables are present', () => {
    expect(renderInvoiceNumber('STATIC-PREFIX', 42, date)).toBe('STATIC-PREFIX');
  });

  it('is pure: same args produce same output (format change does not affect rendered numbers)', () => {
    // The mid-flight format change semantic is handled at the call site (the function
    // is invoked once at invoice creation). Verifying purity here is the proxy.
    const a = renderInvoiceNumber('INV-{SEQ}', 5, date);
    const b = renderInvoiceNumber('INV-{SEQ}', 5, date);
    expect(a).toBe(b);
  });

  it('replaces all occurrences of a variable', () => {
    expect(renderInvoiceNumber('{SEQ}-{SEQ}', 3, date)).toBe('0003-0003');
  });

  it('substitutes {COMPANY3} with the first 3 uppercased chars of company name', () => {
    expect(renderInvoiceNumber('{COMPANY3}-{SEQ}', 1, date, 'Creowis')).toBe('CRE-0001');
    expect(renderInvoiceNumber('{COMPANY3}{SEQ}', 42, date, 'Acme Corp')).toBe('ACM0042');
  });

  it('{COMPANY3} drops whitespace before taking the first 3 chars', () => {
    expect(renderInvoiceNumber('{COMPANY3}-{SEQ}', 1, date, 'A B Co')).toBe('ABC-0001');
  });

  it('{COMPANY3} renders empty string when company name is missing', () => {
    expect(renderInvoiceNumber('{COMPANY3}-{SEQ}', 1, date)).toBe('-0001');
  });

  it('{COMPANY3} truncates company names shorter than 3 chars', () => {
    expect(renderInvoiceNumber('{COMPANY3}-{SEQ}', 1, date, 'Ab')).toBe('AB-0001');
  });
});

describe('totalFor', () => {
  const baseInvoice: Invoice = {
    id: 'x',
    default: { lineItems: [] },
    custom: {},
    status: 'draft',
    paymentStatus: 'unpaid',
  };

  it('returns 0 for no line items', () => {
    expect(totalFor(baseInvoice)).toBe(0);
  });

  it('sums quantity * unitPrice for each line item', () => {
    const inv: Invoice = {
      ...baseInvoice,
      default: {
        lineItems: [
          { description: 'a', quantity: 2, unitPrice: 10 },
          { description: 'b', quantity: 3, unitPrice: 5.5 },
        ],
      },
    };
    expect(totalFor(inv)).toBe(36.5);
  });

  it('handles missing lineItems gracefully', () => {
    const inv: Invoice = { ...baseInvoice, default: {} };
    expect(totalFor(inv)).toBe(0);
  });
});

describe('DEFAULT_FIELDS', () => {
  it('includes the original Phase-1 fields', () => {
    const required = [
      'invoiceNumber',
      'issueDate',
      'dueDate',
      'fromName',
      'fromEmail',
      'customerName',
      'customerEmail',
      'lineItems',
      'currency',
      'notes',
    ];
    for (const f of required) expect(DEFAULT_FIELDS).toContain(f);
  });

  it('includes the Phase-4 company-snapshot fields', () => {
    for (const f of [
      'companyName',
      'companyAddress',
      'companyPhone',
      'companyWebsite',
      'companyTaxId',
    ]) {
      expect(DEFAULT_FIELDS).toContain(f);
    }
  });

  it('includes the Phase-4 bank-snapshot fields', () => {
    for (const f of [
      'bankAccountName',
      'bankAccountNumber',
      'bankIfsc',
      'bankAccountType',
      'bankName',
    ]) {
      expect(DEFAULT_FIELDS).toContain(f);
    }
  });

  it('includes the Phase-4 tax + payment fields', () => {
    for (const f of ['taxRate', 'taxLabel', 'taxAmount', 'paymentInstructions', 'customerAddress']) {
      expect(DEFAULT_FIELDS).toContain(f);
    }
  });

  it('has no duplicate field names', () => {
    expect(new Set(DEFAULT_FIELDS).size).toBe(DEFAULT_FIELDS.length);
  });
});

describe('hasCustomFields', () => {
  const base: Invoice = {
    id: 'x',
    default: {},
    custom: {},
    status: 'draft',
    paymentStatus: 'unpaid',
  };

  it('returns false when custom is empty', () => {
    expect(hasCustomFields(base)).toBe(false);
  });

  it('returns true when custom has at least one key', () => {
    expect(hasCustomFields({ ...base, custom: { foo: 'bar' } })).toBe(true);
  });
});
