import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import { prepareClone } from './clone.js';

function makeSourceInvoice(): Invoice {
  return {
    id: 'source-id-abc',
    default: {
      invoiceNumber: 'INV-2026-0001',
      issueDate: '2026-01-15',
      dueDate: '2026-02-14',
      fromName: 'Joy',
      fromEmail: 'joy@creowis.com',
      companyName: 'Creowis',
      companyAddress: 'Bangalore',
      companyPhone: '+91 99999',
      customerName: 'Acme',
      customerEmail: 'pay@acme.com',
      customerAddress: 'Mumbai',
      lineItems: [
        { description: 'Monthly retainer', quantity: 1, unitPrice: 100000 },
        { description: 'Setup', quantity: 1, unitPrice: 5000 },
      ],
      currency: 'INR',
      taxRate: 0.18,
      taxLabel: 'GST',
      taxAmount: 18900,
      bankAccountName: 'Joy',
      bankAccountNumber: '111222333',
      bankIfsc: 'BANK0001',
      paymentInstructions: 'Wire to the above',
      notes: 'Thank you',
    },
    custom: { purchaseOrderNumber: 'PO-2026-001' },
    status: 'sent',
    sentAt: '2026-01-15T10:00:00Z',
    recipients: { to: ['hello@creowis.com'] },
    paymentStatus: 'paid',
    paidAt: '2026-01-20T09:00:00Z',
  };
}

describe('prepareClone', () => {
  const overrides = {
    id: 'new-id-xyz',
    invoiceNumber: 'INV-2026-0002',
    issueDate: '2026-02-15',
    dueDate: '2026-03-17',
  };

  it('replaces id, invoiceNumber, issueDate, dueDate from overrides', () => {
    const cloned = prepareClone(makeSourceInvoice(), overrides);
    expect(cloned.id).toBe('new-id-xyz');
    expect(cloned.default.invoiceNumber).toBe('INV-2026-0002');
    expect(cloned.default.issueDate).toBe('2026-02-15');
    expect(cloned.default.dueDate).toBe('2026-03-17');
  });

  it('resets status to draft and clears sentAt/recipients', () => {
    const cloned = prepareClone(makeSourceInvoice(), overrides);
    expect(cloned.status).toBe('draft');
    expect(cloned.sentAt).toBeUndefined();
    expect(cloned.recipients).toBeUndefined();
  });

  it('resets paymentStatus to unpaid and clears paidAt', () => {
    const cloned = prepareClone(makeSourceInvoice(), overrides);
    expect(cloned.paymentStatus).toBe('unpaid');
    expect(cloned.paidAt).toBeUndefined();
  });

  it('preserves customer, line items, bank details, tax, notes', () => {
    const source = makeSourceInvoice();
    const cloned = prepareClone(source, overrides);
    expect(cloned.default.customerName).toBe(source.default.customerName);
    expect(cloned.default.customerEmail).toBe(source.default.customerEmail);
    expect(cloned.default.customerAddress).toBe(source.default.customerAddress);
    expect(cloned.default.lineItems).toEqual(source.default.lineItems);
    expect(cloned.default.bankAccountName).toBe(source.default.bankAccountName);
    expect(cloned.default.bankAccountNumber).toBe(source.default.bankAccountNumber);
    expect(cloned.default.bankIfsc).toBe(source.default.bankIfsc);
    expect(cloned.default.taxRate).toBe(source.default.taxRate);
    expect(cloned.default.taxLabel).toBe(source.default.taxLabel);
    expect(cloned.default.taxAmount).toBe(source.default.taxAmount);
    expect(cloned.default.paymentInstructions).toBe(source.default.paymentInstructions);
    expect(cloned.default.notes).toBe(source.default.notes);
    expect(cloned.default.companyName).toBe(source.default.companyName);
    expect(cloned.default.companyPhone).toBe(source.default.companyPhone);
  });

  it('preserves invoice.custom intact', () => {
    const cloned = prepareClone(makeSourceInvoice(), overrides);
    expect(cloned.custom).toEqual({ purchaseOrderNumber: 'PO-2026-001' });
  });

  it('does not mutate the source invoice', () => {
    const source = makeSourceInvoice();
    const before = JSON.parse(JSON.stringify(source));
    prepareClone(source, overrides);
    expect(source).toEqual(before);
  });

  it('detaches custom object so later edits do not leak to source', () => {
    const source = makeSourceInvoice();
    const cloned = prepareClone(source, overrides);
    (cloned.custom as Record<string, unknown>).extraKey = 'value';
    expect(source.custom).not.toHaveProperty('extraKey');
  });

  it('honors an arbitrary new uuid', () => {
    const fresh = randomUUID();
    const cloned = prepareClone(makeSourceInvoice(), { ...overrides, id: fresh });
    expect(cloned.id).toBe(fresh);
  });
});
