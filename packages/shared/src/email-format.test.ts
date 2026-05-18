import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderSubject, subjectFor } from './email-format.js';
import type { Invoice } from './invoice.js';

function makeInvoice(): Invoice {
  return {
    id: randomUUID(),
    default: {
      invoiceNumber: 'INV-2026-0042',
      customerName: 'Acme',
      currency: 'INR',
      issueDate: '2026-05-17',
      dueDate: '2026-06-17',
      lineItems: [{ description: 'Consulting', quantity: 5, unitPrice: 150 }],
    },
    custom: {},
    status: 'draft',
    paymentStatus: 'unpaid',
  };
}

describe('renderSubject', () => {
  it('substitutes all six placeholders', () => {
    const out = renderSubject(
      '{invoiceNumber} for {customerName} - {total} {currency} (issued {issueDate}, due {dueDate})',
      makeInvoice(),
    );
    expect(out).toBe('INV-2026-0042 for Acme - 750.00 INR (issued 2026-05-17, due 2026-06-17)');
  });

  it('substitutes a single placeholder', () => {
    expect(renderSubject('Invoice {invoiceNumber}', makeInvoice())).toBe('Invoice INV-2026-0042');
  });

  it('substitutes repeated occurrences of the same placeholder', () => {
    expect(renderSubject('{invoiceNumber} - {invoiceNumber}', makeInvoice())).toBe(
      'INV-2026-0042 - INV-2026-0042',
    );
  });

  it('returns the template unchanged when no placeholders match', () => {
    expect(renderSubject('Plain subject', makeInvoice())).toBe('Plain subject');
  });

  it('leaves unknown placeholders as-is so typos are visible', () => {
    expect(renderSubject('{invoiceNumber} {bogus} {customerName}', makeInvoice())).toBe(
      'INV-2026-0042 {bogus} Acme',
    );
  });

  it('renders empty string for missing invoice fields (does not crash)', () => {
    const inv = makeInvoice();
    delete inv.default.customerName;
    delete inv.default.dueDate;
    const out = renderSubject('{customerName} {invoiceNumber} {dueDate}', inv);
    expect(out).toBe(' INV-2026-0042 ');
  });

  it('computes total as fixed(2) from lineItems', () => {
    const inv = makeInvoice();
    inv.default.lineItems = [
      { description: 'a', quantity: 2, unitPrice: 99.95 },
      { description: 'b', quantity: 1, unitPrice: 0.01 },
    ];
    expect(renderSubject('{total}', inv)).toBe('199.91');
  });
});

describe('subjectFor (default)', () => {
  it('produces a sensible default subject without a template', () => {
    const out = subjectFor(makeInvoice());
    expect(out).toContain('INV-2026-0042');
    expect(out).toContain('Acme');
    expect(out).toContain('INR');
  });
});
