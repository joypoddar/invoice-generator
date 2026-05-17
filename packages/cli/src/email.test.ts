import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { INVOICE_HEADER_NAME, type Invoice } from '@invoice/shared';
import { buildMailOptions, renderInvoiceHtml, type Recipients } from './email.js';

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

describe('buildMailOptions', () => {
  const recipients: Recipients = { to: ['hello@creowis.com'] };
  const from = 'joy@creowis.com';

  it('sets the X-Invoice-Generator header to 1', () => {
    const opts = buildMailOptions(makeInvoice(), recipients, from);
    expect(opts.headers).toMatchObject({ [INVOICE_HEADER_NAME]: '1' });
  });

  it('attaches exactly one file: the JSON sidecar (no PDF)', () => {
    const inv = makeInvoice();
    const opts = buildMailOptions(inv, recipients, from);
    expect(opts.attachments).toHaveLength(1);
    const att = opts.attachments?.[0];
    expect(att?.filename).toBe('invoice-INV-2026-0042.json');
    expect(att?.contentType).toBe('application/json');
    const parsed = JSON.parse(att?.content as string) as Invoice;
    expect(parsed).toEqual(inv);
  });

  it('renders subject via the shared subjectFor helper', () => {
    const opts = buildMailOptions(makeInvoice(), recipients, from);
    expect(opts.subject).toContain('INV-2026-0042');
    expect(opts.subject).toContain('Acme');
    expect(opts.subject).toContain('USD');
  });

  it('threads RenderOpts through to the HTML body', () => {
    const opts = buildMailOptions(makeInvoice(), recipients, from, {
      branding: { primaryColor: '#ff00ff' },
    });
    expect(opts.html).toContain('#ff00ff');
  });

  it('sets to/cc/bcc as comma-joined strings', () => {
    const opts = buildMailOptions(
      makeInvoice(),
      { to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'], bcc: ['d@x.com'] },
      from,
    );
    expect(opts.to).toBe('a@x.com, b@x.com');
    expect(opts.cc).toBe('c@x.com');
    expect(opts.bcc).toBe('d@x.com');
  });

  it('omits cc/bcc when empty', () => {
    const opts = buildMailOptions(makeInvoice(), { to: ['x@y.com'] }, from);
    expect(opts.cc).toBeUndefined();
    expect(opts.bcc).toBeUndefined();
  });

  it('uses the given from address', () => {
    const opts = buildMailOptions(makeInvoice(), recipients, 'someone@else.com');
    expect(opts.from).toBe('someone@else.com');
  });
});

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

  it('renders a tax row in the total block when default.taxRate is set', () => {
    const inv = makeInvoice();
    inv.default.taxRate = 0.18;
    inv.default.taxLabel = 'GST';
    inv.default.taxAmount = 171; // 18% of 950
    const html = renderInvoiceHtml(inv);
    expect(html).toContain('Subtotal');
    expect(html).toContain('GST');
    expect(html).toContain('18%');
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
