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

  it('renders a custom-fields section when invoice.custom has keys', () => {
    const html = renderInvoiceHtml(
      makeInvoice({ custom: { purchaseOrderNumber: 'PO-123' } }),
    );
    expect(html).toContain('Additional fields');
    expect(html).toContain('purchaseOrderNumber');
    expect(html).toContain('PO-123');
  });

  it('omits the custom-fields section when invoice.custom is empty', () => {
    const html = renderInvoiceHtml(makeInvoice());
    expect(html).not.toContain('Additional fields');
  });
});
