import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import { renderInvoiceHtml } from './invoice-html.js';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: randomUUID(),
    default: {
      invoiceNumber: 'INV-2026-0042',
      fromName: 'Joy',
      fromEmail: 'joy@creowis.com',
      customerName: 'Acme',
      customerEmail: 'pay@acme.com',
      issueDate: '2026-05-17',
      dueDate: '2026-06-17',
      currency: 'USD',
      lineItems: [
        { description: 'Consulting', quantity: 5, unitPrice: 150 },
        { description: 'Setup', quantity: 1, unitPrice: 200 },
      ],
      notes: 'Thank you.',
    },
    custom: {},
    status: 'draft',
    paymentStatus: 'unpaid',
    ...overrides,
  };
}

describe('renderInvoiceHtml', () => {
  it('includes invoice number, customer name, and computed total', () => {
    const html = renderInvoiceHtml(makeInvoice());
    expect(html).toContain('INV-2026-0042');
    expect(html).toContain('Acme');
    expect(html).toContain('950.00'); // 5*150 + 200
  });

  it('formats dates as DD/MM/YYYY by default', () => {
    const html = renderInvoiceHtml(makeInvoice());
    expect(html).toContain('17/05/2026'); // issue date
    expect(html).toContain('17/06/2026'); // due date
  });

  it('honors a custom dateFormat opts', () => {
    const html = renderInvoiceHtml(makeInvoice(), { dateFormat: 'YYYY-MM-DD' });
    expect(html).toContain('2026-05-17');
  });

  it('uses Intl currency formatting (INR comma-grouping)', () => {
    const inv = makeInvoice();
    inv.default.currency = 'INR';
    inv.default.lineItems = [{ description: 'big', quantity: 1, unitPrice: 1234567.89 }];
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('12,34,567.89');
  });

  it('uses Western grouping for USD', () => {
    const inv = makeInvoice();
    inv.default.lineItems = [{ description: 'big', quantity: 1, unitPrice: 12345.67 }];
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('12,345.67');
  });

  it('uses the configured primary color when provided', () => {
    const html = renderInvoiceHtml(makeInvoice(), { branding: { primaryColor: '#cc0000' } });
    expect(html).toContain('#cc0000');
    expect(html).not.toContain('#3949ab');
  });

  it('uses the default primary color when no branding override', () => {
    const html = renderInvoiceHtml(makeInvoice());
    expect(html).toContain('#3949ab');
  });

  it('uses the configured font family when provided', () => {
    const html = renderInvoiceHtml(makeInvoice(), {
      branding: { fontFamily: "'Roboto', sans-serif" },
    });
    expect(html).toContain("'Roboto', sans-serif");
  });

  it('reads company phone from default.companyPhone first', () => {
    const inv = makeInvoice();
    inv.default.companyPhone = '+91 99999';
    inv.custom = { fromPhone: '+1 SHOULD-NOT-WIN' };
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('+91 99999');
    expect(html).not.toContain('SHOULD-NOT-WIN');
  });

  it('falls back to custom.fromPhone (legacy) when default.companyPhone is missing', () => {
    const inv = makeInvoice();
    inv.custom = { fromPhone: '+91 LEGACY' };
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('+91 LEGACY');
  });

  it('reads bank details from default.bank* first', () => {
    const inv = makeInvoice();
    inv.default.bankAccountName = 'Joy Poddar';
    inv.default.bankAccountNumber = '111222333';
    inv.default.bankIfsc = 'BANK0001';
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('Joy Poddar');
    expect(html).toContain('111222333');
    expect(html).toContain('BANK0001');
    expect(html).toContain('Bank Details');
  });

  it('falls back to custom.bank* for legacy invoices', () => {
    const inv = makeInvoice();
    inv.custom = { bankAccountName: 'Legacy Holder', bankIfsc: 'LEGACY01' };
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('Legacy Holder');
    expect(html).toContain('LEGACY01');
    expect(html).toContain('Bank Details');
  });

  it('omits the Bank Details block when no bank fields are set', () => {
    const html = renderInvoiceHtml(makeInvoice());
    expect(html).not.toContain('Bank Details');
  });

  it('uppercases bankIfsc defensively at render time (handles pre-4.10 lowercase configs)', () => {
    const inv = makeInvoice();
    inv.default.bankAccountName = 'Joy';
    inv.default.bankIfsc = 'hdfc0001234';
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('HDFC0001234');
    expect(html).not.toContain('hdfc0001234');
  });

  it('renders a tax row in the total block when default.taxRate is set', () => {
    const inv = makeInvoice();
    inv.default.taxRate = 0.18;
    inv.default.taxLabel = 'GST';
    inv.default.taxAmount = 171; // 18% of 950
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('Amount'); // PDF-style total block label
    expect(html).toContain('GST');
    expect(html).toContain('171.00');
    expect(html).toContain('1,121.00'); // total = 950 + 171
  });

  it('renders Payment Instructions block when set', () => {
    const inv = makeInvoice();
    inv.default.paymentInstructions = 'Wire to:\nAccount 12345';
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('Payment Instructions');
    expect(html).toContain('Wire to:');
    expect(html).toContain('Account 12345');
  });

  it('does not render Payment Instructions block when unset', () => {
    const html = renderInvoiceHtml(makeInvoice());
    expect(html).not.toContain('Payment Instructions');
  });

  it('renders customerPhone in Billed To when set', () => {
    const inv = makeInvoice();
    inv.default.customerPhone = '+91 12345 67890';
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('+91 12345 67890');
  });

  describe('PDF-design parity (Phase 4.5)', () => {
    it('renders the 6-column line-item table by default', () => {
      const html = renderInvoiceHtml(makeInvoice());
      // Default header (changeable via def.lineItemHeader)
      expect(html).toContain('Description');
      expect(html).toContain('Quantity');
      expect(html).toContain('Rate');
      // "Amount" appears both as column header and total-block label
      expect(html).toMatch(/Amount/);
      expect(html).toContain('Total</th>');
    });

    it('uses the configured lineItemHeader from invoice.default', () => {
      const inv = makeInvoice();
      inv.default.lineItemHeader = 'Job Position';
      const html = renderInvoiceHtml(inv);
      expect(html).toContain('Job Position');
    });

    it('shows the tax column only when any line has a rate or invoice has one', () => {
      const noTax = renderInvoiceHtml(makeInvoice());
      expect(noTax).not.toContain('>Tax</th>');
      // Invoice-level taxRate triggers the column
      const withTax = makeInvoice();
      withTax.default.taxRate = 0.18;
      withTax.default.taxLabel = 'GST';
      expect(renderInvoiceHtml(withTax)).toContain('>GST</th>');
    });

    it('computes per-line IGST when a line item has its own taxRate', () => {
      const inv = makeInvoice();
      inv.default.lineItems = [
        { description: 'taxed line', quantity: 1, unitPrice: 1000, taxRate: 0.18 },
        { description: 'untaxed line', quantity: 1, unitPrice: 500 },
      ];
      inv.default.taxLabel = 'GST';
      const html = renderInvoiceHtml(inv);
      // Per-line IGST: 1000 × 0.18 = 180, 500 × 0 = 0
      expect(html).toContain('180.00');
      // Subtotal in total block: 1000 + 500 = 1500
      expect(html).toContain('1,500.00');
      // Total: 1500 + 180 = 1680
      expect(html).toContain('1,680.00');
    });

    it('Rate column uses fraction-only-if-present formatting', () => {
      const inv = makeInvoice();
      inv.default.lineItems = [
        { description: 'whole', quantity: 1, unitPrice: 55000 },
        { description: 'fractional', quantity: 1, unitPrice: 99.5 },
      ];
      inv.default.currency = 'INR';
      const html = renderInvoiceHtml(inv);
      // Rate cell: whole → "55,000" (no .00). Amount cell: "55,000.00" (always .00).
      // Both formats appear; we check the integer form is present without trailing .00
      expect(html).toMatch(/₹55,000(?!\.0)/);
      // Fractional line shows decimals in Rate
      expect(html).toMatch(/99\.50/);
    });

    it('renders the Billed By company address with newline → <br/>', () => {
      const inv = makeInvoice();
      inv.default.companyAddress = '752 Catania Tower,\nMahagun Mascot Society,\nGhaziabad';
      const html = renderInvoiceHtml(inv);
      expect(html).toContain('752 Catania Tower,');
      expect(html).toContain('Mahagun Mascot Society,');
      expect(html).toContain('<br/>');
    });

    it('renders a signature block when branding.signatureUrl is an http URL', () => {
      const html = renderInvoiceHtml(makeInvoice(), {
        branding: { signatureUrl: 'https://example.com/sig.png' },
      });
      expect(html).toContain('https://example.com/sig.png');
      expect(html).toContain('Authorised Signatory');
    });

    it('signature block uses a custom signatoryLabel when set', () => {
      const html = renderInvoiceHtml(makeInvoice(), {
        branding: {
          signatureUrl: 'https://example.com/sig.png',
          signatoryLabel: 'Founder',
        },
      });
      expect(html).toContain('Founder');
      expect(html).not.toContain('Authorised Signatory');
    });

    it('omits the signature block when signatureUrl is unset', () => {
      const html = renderInvoiceHtml(makeInvoice());
      expect(html).not.toContain('Authorised Signatory');
    });

    it('omits the signature block when a local path cannot be read', () => {
      const html = renderInvoiceHtml(makeInvoice(), {
        branding: { signatureUrl: '/nonexistent/path/sig.png' },
      });
      expect(html).not.toContain('Authorised Signatory');
    });
  });

  describe('print CSS', () => {
    it('includes an @page rule for A4', () => {
      const html = renderInvoiceHtml(makeInvoice());
      expect(html).toMatch(/@page\s*\{[^}]*size:\s*A4/);
    });

    it('includes an @media print block', () => {
      const html = renderInvoiceHtml(makeInvoice());
      expect(html).toMatch(/@media\s+print\s*\{/);
    });

    it('includes page-break-inside: avoid for table rows', () => {
      const html = renderInvoiceHtml(makeInvoice());
      expect(html).toContain('page-break-inside');
    });

    it('tags the outer card with class="invoice-card" for print targeting', () => {
      const html = renderInvoiceHtml(makeInvoice());
      expect(html).toContain('class="invoice-card"');
    });

    it('exposes a .no-print class for dashboard UI chrome (Phase 5)', () => {
      const html = renderInvoiceHtml(makeInvoice());
      expect(html).toContain('.no-print');
    });
  });

  it('reads customer address from default first, custom legacy second', () => {
    const a = makeInvoice();
    a.default.customerAddress = 'New default address';
    expect(renderInvoiceHtml(a)).toContain('New default address');

    const b = makeInvoice();
    b.custom = { customerAddress: 'Legacy custom address' };
    expect(renderInvoiceHtml(b)).toContain('Legacy custom address');
  });

  it('escapes HTML special characters in fields', () => {
    const html = renderInvoiceHtml(
      makeInvoice({
        default: {
          ...makeInvoice().default,
          customerName: '<script>alert(1)</script>',
        },
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a custom-fields section when invoice.custom has non-bank keys', () => {
    const html = renderInvoiceHtml(
      makeInvoice({ custom: { purchaseOrderNumber: 'PO-123' } }),
    );
    expect(html).toContain('Additional Information');
    expect(html).toContain('purchaseOrderNumber');
    expect(html).toContain('PO-123');
  });

  it('omits the custom-fields section when invoice.custom is empty', () => {
    const html = renderInvoiceHtml(makeInvoice());
    expect(html).not.toContain('Additional Information');
  });
});
