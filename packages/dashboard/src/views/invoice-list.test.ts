import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import { renderInvoiceListPage } from './invoice-list.js';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: randomUUID(),
    default: {
      invoiceNumber: 'INV-2026-0042',
      customerName: 'Acme',
      issueDate: '2026-05-17',
      dueDate: '2026-06-17',
      currency: 'USD',
      lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 500 }],
    },
    custom: {},
    status: 'draft',
    paymentStatus: 'unpaid',
    ...overrides,
  };
}

describe('renderInvoiceListPage', () => {
  it('renders an empty-state message when no invoices exist', () => {
    const html = renderInvoiceListPage([]);
    expect(html).toContain('No invoices yet');
    expect(html).toContain('invoice new');
  });

  it('renders one row per invoice with the short id linking to /invoices/:id', () => {
    const inv = makeInvoice();
    const html = renderInvoiceListPage([inv]);
    expect(html).toContain(inv.id.slice(0, 8));
    expect(html).toContain(`href="/invoices/${inv.id}"`);
    expect(html).toContain('INV-2026-0042');
    expect(html).toContain('Acme');
  });

  it('shows draft vs sent badges', () => {
    const drafts = renderInvoiceListPage([makeInvoice()]);
    expect(drafts).toContain('badge-draft');
    expect(drafts).toContain('>draft<');

    const sent = renderInvoiceListPage([
      makeInvoice({ status: 'sent', sentAt: '2026-05-18T00:00:00Z' }),
    ]);
    expect(sent).toContain('badge-sent');
    expect(sent).toContain('>sent<');
  });

  it('shows paid vs unpaid badges', () => {
    const unpaid = renderInvoiceListPage([makeInvoice()]);
    expect(unpaid).toContain('badge-unpaid');
    expect(unpaid).toContain('>unpaid<');

    const paid = renderInvoiceListPage([
      makeInvoice({ paymentStatus: 'paid', paidAt: '2026-05-30T00:00:00Z' }),
    ]);
    expect(paid).toContain('badge-paid');
    expect(paid).toContain('>paid<');
  });

  it('renders the computed total with currency suffix', () => {
    const html = renderInvoiceListPage([makeInvoice()]);
    expect(html).toContain('500.00 USD');
  });
});
