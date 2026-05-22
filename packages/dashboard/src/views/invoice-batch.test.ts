import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import { BATCH_CAP, renderInvoiceBatchPage } from './invoice-batch.js';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: randomUUID(),
    default: {
      invoiceNumber: 'INV-2026-0001',
      fromName: 'Joy',
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

describe('renderInvoiceBatchPage', () => {
  it('exports a 50-invoice batch cap (matches the list-page UI)', () => {
    expect(BATCH_CAP).toBe(50);
  });

  it('renders a single invoice without a page-break wrapper', () => {
    const html = renderInvoiceBatchPage([makeInvoice()], {
      localUserName: 'John Doe',
      today: '2026-05-22',
    });
    expect(html).toContain('class="invoice-card"');
    expect(html).not.toContain('page-break-before: always');
  });

  it('renders multiple invoices with page-break-before between them', () => {
    const html = renderInvoiceBatchPage(
      [makeInvoice(), makeInvoice(), makeInvoice()],
      { localUserName: 'John Doe', today: '2026-05-22' },
    );
    // 3 cards total; 2 page-break wrappers (first is unwrapped)
    const cardMatches = html.match(/class="invoice-card"/g);
    expect(cardMatches?.length).toBe(3);
    const breakMatches = html.match(/page-break-before:\s*always/g);
    expect(breakMatches?.length).toBe(2);
  });

  it('builds the document title from the local user and date', () => {
    const html = renderInvoiceBatchPage([makeInvoice()], {
      localUserName: 'John Doe',
      today: '2026-05-22',
    });
    expect(html).toContain('<title>john_doe_invoices_2026-05-22</title>');
  });

  it('falls back to `invoices_<date>` when the local user name is empty', () => {
    const html = renderInvoiceBatchPage([makeInvoice()], {
      localUserName: '',
      today: '2026-05-22',
    });
    expect(html).toContain('<title>invoices_2026-05-22</title>');
  });

  it('auto-fires window.print() via a setTimeout after page load', () => {
    const html = renderInvoiceBatchPage([makeInvoice()], {
      localUserName: 'John Doe',
      today: '2026-05-22',
    });
    expect(html).toMatch(/setTimeout\([\s\S]*?window\.print\(\)/);
  });

  it('includes a .no-print back toolbar so users can cancel', () => {
    const html = renderInvoiceBatchPage([makeInvoice()], {
      localUserName: 'John Doe',
      today: '2026-05-22',
    });
    expect(html).toMatch(/<div class="no-print"[\s\S]*?href="\/invoices"[\s\S]*?← Back/);
  });

  it('includes the shared print CSS (@page margin 0 + no-print rule)', () => {
    const html = renderInvoiceBatchPage([makeInvoice()], {
      localUserName: 'John Doe',
      today: '2026-05-22',
    });
    expect(html).toMatch(/@page\s*\{[^}]*margin:\s*0/);
    expect(html).toMatch(/\.no-print\s*\{\s*display:\s*none\s*!important/);
  });
});
