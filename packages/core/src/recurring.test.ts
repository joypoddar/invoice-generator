import { describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import {
  computeNextRun,
  FREQUENCIES,
  isFrequency,
  materializeFromTemplate,
  prepareClone,
  templateFromInvoice,
  type Template,
} from './recurring.js';

function makeInvoice(): Invoice {
  return {
    id: 'src-1',
    default: {
      invoiceNumber: 'INV-2026-0001',
      issueDate: '2026-01-15',
      dueDate: '2026-02-14',
      fromName: 'Joy',
      companyName: 'Creowis',
      customerName: 'Acme',
      lineItems: [{ description: 'Retainer', quantity: 1, unitPrice: 100000 }],
      currency: 'INR',
      taxRate: 0.18,
      taxLabel: 'GST',
      taxAmount: 18000,
      bankAccountName: 'Joy',
      paymentInstructions: 'Wire',
      notes: 'Thanks',
    },
    custom: { po: 'PO-001' },
    status: 'sent',
    sentAt: '2026-01-15T10:00:00Z',
    paymentStatus: 'paid',
    paidAt: '2026-01-20T09:00:00Z',
  };
}

describe('computeNextRun', () => {
  it('advances daily by 1 day', () => {
    const next = computeNextRun(new Date('2026-05-17T00:00:00Z'), 'daily');
    expect(next.toISOString().slice(0, 10)).toBe('2026-05-18');
  });

  it('advances weekly by 7 days', () => {
    const next = computeNextRun(new Date('2026-05-17T00:00:00Z'), 'weekly');
    expect(next.toISOString().slice(0, 10)).toBe('2026-05-24');
  });

  it('advances monthly to the same day of the next month', () => {
    const next = computeNextRun(new Date('2026-05-17T00:00:00Z'), 'monthly');
    expect(next.toISOString().slice(0, 10)).toBe('2026-06-17');
  });

  it('handles month rollover for late dates (Jan 31 + 1 month → Mar 3, JS Date semantics)', () => {
    const next = computeNextRun(new Date('2026-01-31T00:00:00Z'), 'monthly');
    // JS Date.setMonth(Jan 31 + 1) rolls over to Mar 3 (or Mar 2 depending on leap)
    expect(next.toISOString().slice(0, 10)).toMatch(/^2026-03-0[23]$/);
  });

  it('advances yearly by 1 year', () => {
    const next = computeNextRun(new Date('2026-05-17T00:00:00Z'), 'yearly');
    expect(next.toISOString().slice(0, 10)).toBe('2027-05-17');
  });

  it('handles leap-year transition (Feb 29 + 1 year → Mar 1)', () => {
    const next = computeNextRun(new Date('2024-02-29T00:00:00Z'), 'yearly');
    expect(next.toISOString().slice(0, 10)).toMatch(/^2025-(02-28|03-01)$/);
  });

  it('does not mutate the input date', () => {
    const start = new Date('2026-05-17T00:00:00Z');
    const startCopy = new Date(start);
    computeNextRun(start, 'monthly');
    expect(start.toISOString()).toBe(startCopy.toISOString());
  });
});

describe('isFrequency', () => {
  it('returns true for valid frequencies', () => {
    for (const f of FREQUENCIES) expect(isFrequency(f)).toBe(true);
  });
  it('returns false for invalid values', () => {
    expect(isFrequency('hourly')).toBe(false);
    expect(isFrequency('')).toBe(false);
    expect(isFrequency(null)).toBe(false);
    expect(isFrequency(undefined)).toBe(false);
    expect(isFrequency(42)).toBe(false);
  });
});

describe('prepareClone', () => {
  const overrides = {
    id: 'new-id',
    invoiceNumber: 'INV-2026-0002',
    issueDate: '2026-02-15',
    dueDate: '2026-03-17',
  };

  it('replaces identity fields', () => {
    const cloned = prepareClone(makeInvoice(), overrides);
    expect(cloned.id).toBe('new-id');
    expect(cloned.default.invoiceNumber).toBe('INV-2026-0002');
    expect(cloned.default.issueDate).toBe('2026-02-15');
    expect(cloned.default.dueDate).toBe('2026-03-17');
  });

  it('resets status and clears sent/payment state', () => {
    const cloned = prepareClone(makeInvoice(), overrides);
    expect(cloned.status).toBe('draft');
    expect(cloned.paymentStatus).toBe('unpaid');
    expect(cloned.sentAt).toBeUndefined();
    expect(cloned.paidAt).toBeUndefined();
    expect(cloned.recipients).toBeUndefined();
  });

  it('preserves customer/bank/tax/notes/custom', () => {
    const src = makeInvoice();
    const cloned = prepareClone(src, overrides);
    expect(cloned.default.customerName).toBe('Acme');
    expect(cloned.default.bankAccountName).toBe('Joy');
    expect(cloned.default.taxRate).toBe(0.18);
    expect(cloned.default.notes).toBe('Thanks');
    expect(cloned.custom).toEqual({ po: 'PO-001' });
  });

  it('detaches custom so caller edits do not leak to source', () => {
    const src = makeInvoice();
    const cloned = prepareClone(src, overrides);
    (cloned.custom as Record<string, unknown>).extra = 'x';
    expect(src.custom).not.toHaveProperty('extra');
  });
});

describe('templateFromInvoice', () => {
  it('strips per-send identity from default', () => {
    const t = templateFromInvoice(makeInvoice());
    expect(t.default).not.toHaveProperty('invoiceNumber');
    expect(t.default).not.toHaveProperty('issueDate');
    expect(t.default).not.toHaveProperty('dueDate');
    expect(t.default).not.toHaveProperty('taxAmount');
  });
  it('preserves the rest', () => {
    const t = templateFromInvoice(makeInvoice());
    expect(t.default.customerName).toBe('Acme');
    expect(t.default.taxRate).toBe(0.18);
    expect(t.custom).toEqual({ po: 'PO-001' });
  });
  it('drops top-level state', () => {
    const t = templateFromInvoice(makeInvoice()) as unknown as Record<string, unknown>;
    expect(t.id).toBeUndefined();
    expect(t.status).toBeUndefined();
    expect(t.sentAt).toBeUndefined();
    expect(t.paymentStatus).toBeUndefined();
  });
});

describe('materializeFromTemplate', () => {
  const overrides = {
    id: 'new-id',
    invoiceNumber: 'INV-2026-0002',
    issueDate: '2026-02-15',
    dueDate: '2026-03-17',
  };

  it('produces a fresh draft invoice', () => {
    const t = templateFromInvoice(makeInvoice());
    const inv = materializeFromTemplate(t, overrides);
    expect(inv.status).toBe('draft');
    expect(inv.paymentStatus).toBe('unpaid');
    expect(inv.id).toBe('new-id');
    expect(inv.default.invoiceNumber).toBe('INV-2026-0002');
  });

  it('recomputes taxAmount from rate × subtotal', () => {
    const t: Template = {
      default: {
        lineItems: [{ description: 'a', quantity: 2, unitPrice: 50 }],
        taxRate: 0.1,
      },
      custom: {},
    };
    const inv = materializeFromTemplate(t, overrides);
    expect(inv.default.taxAmount).toBe(10); // 100 × 0.1
  });

  it('leaves taxAmount unset when taxRate is missing', () => {
    const t: Template = {
      default: { lineItems: [{ description: 'a', quantity: 1, unitPrice: 100 }] },
      custom: {},
    };
    const inv = materializeFromTemplate(t, overrides);
    expect(inv.default.taxAmount).toBeUndefined();
  });
});
