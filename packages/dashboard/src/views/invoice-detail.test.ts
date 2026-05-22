import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import { renderInvoiceDetailPage } from './invoice-detail.js';

function makeInvoice(): Invoice {
  return {
    id: randomUUID(),
    default: {
      invoiceNumber: 'INV-2026-0042',
      fromName: 'Joy',
      fromEmail: 'joy@creowis.com',
      customerName: 'Acme',
      issueDate: '2026-05-17',
      dueDate: '2026-06-17',
      currency: 'USD',
      lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 500 }],
    },
    custom: {},
    status: 'draft',
    paymentStatus: 'unpaid',
  };
}

describe('renderInvoiceDetailPage', () => {
  it('includes the canonical invoice card', () => {
    const html = renderInvoiceDetailPage(makeInvoice());
    expect(html).toContain('INV-2026-0042');
    expect(html).toContain('Acme');
    expect(html).toContain('class="invoice-card"');
  });

  it('injects the dashboard toolbar with a class="no-print" wrapper', () => {
    const html = renderInvoiceDetailPage(makeInvoice());
    expect(html).toMatch(/<div class="no-print"[^>]*>[\s\S]*?Print \/ Save as PDF/);
  });

  it('toolbar has a Print button calling window.print()', () => {
    const html = renderInvoiceDetailPage(makeInvoice());
    expect(html).toContain('window.print()');
  });

  it('toolbar has a back link to the list page', () => {
    const html = renderInvoiceDetailPage(makeInvoice());
    expect(html).toMatch(/href="\/invoices"[^>]*>← All invoices/);
  });

  it('threads RenderOpts through to the underlying renderer', () => {
    const html = renderInvoiceDetailPage(makeInvoice(), {
      branding: { primaryColor: '#cc0000' },
    });
    expect(html).toContain('#cc0000');
  });

  it('still contains the renderer .no-print rule so the toolbar disappears in print', () => {
    const html = renderInvoiceDetailPage(makeInvoice());
    expect(html).toMatch(/\.no-print\s*\{\s*display:\s*none\s*!important;/);
  });
});
