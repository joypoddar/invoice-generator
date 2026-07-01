import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { INVOICE_HEADER_NAME, type Invoice, type Voucher } from '@invoice/shared';
import { buildMailOptions, buildVoucherMailOptions, type Recipients } from './email.js';

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

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: randomUUID(),
    voucherNumber: 'JP_May26_02',
    title: 'Employee Payment Voucher',
    payTo: 'Acme Corp',
    date: '2026-05-17',
    currency: 'USD',
    lines: [{ paymentMethod: 'Bank transfer', description: 'Reimbursement', amount: 420 }],
    preparedBy: 'Joy',
    receivedBy: 'Joy',
    createdAt: new Date().toISOString(),
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

  it('applies subjectTemplate when provided', () => {
    const opts = buildMailOptions(makeInvoice(), recipients, from, {
      subjectTemplate: 'Creowis | {invoiceNumber} for {customerName}',
    });
    expect(opts.subject).toBe('Creowis | INV-2026-0042 for Acme');
  });

  it('falls back to subjectFor when subjectTemplate is not provided', () => {
    const opts = buildMailOptions(makeInvoice(), recipients, from);
    expect(opts.subject).toMatch(/^\[Invoice\] INV-2026-0042/);
  });

  it('empty-string subjectTemplate falls back to default (treats empty as unset)', () => {
    const opts = buildMailOptions(makeInvoice(), recipients, from, { subjectTemplate: '' });
    expect(opts.subject).toMatch(/^\[Invoice\] INV-2026-0042/);
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

  it('builds voucher-specific subject and filename', () => {
    const voucher = makeVoucher();
    const opts = buildVoucherMailOptions(voucher, recipients, 'someone@else.com');
    expect(opts.subject).toBe('Payment Voucher JP_May26_02 for Acme Corp');
    expect(opts.attachments?.[0]?.filename).toBe('voucher-JP_May26_02.json');
    expect(opts.html).toContain('Employee Payment Voucher');
  });

  it('applies subjectTemplate for vouchers', () => {
    const voucher = makeVoucher();
    const opts = buildVoucherMailOptions(voucher, recipients, 'someone@else.com', {
      subjectTemplate: 'PV {voucherNumber} to {payTo}',
    });
    expect(opts.subject).toBe('PV JP_May26_02 to Acme Corp');
  });
});
