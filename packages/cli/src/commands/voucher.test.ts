import { describe, expect, it } from 'vitest';
import type { Config, Voucher } from '@invoice/shared';
import { markVoucher, markVoucherSent, resolveVoucherCompanyInfo } from './voucher.js';

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 'v1',
    voucherNumber: 'JP_May26_01',
    title: 'Employee Payment Voucher',
    payTo: 'Github Copilot',
    date: '2026-05-07',
    currency: 'INR',
    lines: [{ paymentMethod: 'Credit Card', description: 'Delhivery', amount: 186 }],
    preparedBy: 'Joy Poddar',
    receivedBy: 'Joy Poddar',
    createdAt: '2026-05-07T00:00:00.000Z',
    status: 'draft',
    paymentStatus: 'unpaid',
    ...overrides,
  };
}

function makeConfig(): Config {
  return {
    name: 'Joy',
    email: 'joy@example.com',
    currency: 'INR',
    invoice: {
      numberFormat: '{SEQ}',
      nextSeq: 1,
      defaultDueDays: 30,
      lineItemHeader: 'Description',
    },
    voucher: {
      numberFormat: '{SEQ}',
      nextSeq: 1,
      title: 'Employee Payment Voucher',
    },
    company: {
      name: 'Default Company',
      address: 'Default Address',
    },
    branding: {},
    bank: {},
    customers: {},
    storage: { backend: 'sqlite' },
    dashboard: { port: 3000, host: '127.0.0.1' },
    git: { enabled: false, autoCommit: false, autoPush: false, pushRetries: 3 },
    cli: { confirmBeforeSend: true, openPdfAfterPreview: false, logLevel: 'info' },
    llm: {
      provider: 'disabled',
      features: {
        nlInvoiceCreate: false,
        chatQuery: false,
        draftReminders: false,
        summarize: false,
      },
    },
  } as unknown as Config;
}

describe('resolveVoucherCompanyInfo', () => {
  it('uses the selected customer name and address for the voucher header', () => {
    const config = makeConfig();
    const customer = {
      name: 'Creowis Tech Pvt Ltd',
      address: 'Bengaluru\nKarnataka',
    } as Config['customers'][string];

    expect(resolveVoucherCompanyInfo(config, customer)).toEqual({
      companyName: 'Creowis Tech Pvt Ltd',
      companyAddress: 'Bengaluru\nKarnataka',
    });
  });

  it('falls back to the global company info when no customer is selected', () => {
    const config = makeConfig();

    expect(resolveVoucherCompanyInfo(config, null)).toEqual({
      companyName: 'Default Company',
      companyAddress: 'Default Address',
    });
  });
});

describe('markVoucher', () => {
  it('marks paid and stamps paidAt', () => {
    const out = markVoucher(makeVoucher(), 'paid', '2026-06-30T00:00:00.000Z');
    expect(out.paymentStatus).toBe('paid');
    expect(out.paidAt).toBe('2026-06-30T00:00:00.000Z');
  });

  it('marks unpaid and clears paidAt', () => {
    const out = markVoucher(
      makeVoucher({ paymentStatus: 'paid', paidAt: '2026-06-30T00:00:00.000Z' }),
      'unpaid',
    );
    expect(out.paymentStatus).toBe('unpaid');
    expect(out.paidAt).toBeUndefined();
  });
});

describe('markVoucherSent', () => {
  it('records status, sentAt and the recipients snapshot', () => {
    const recipients = { to: ['a@example.com'], cc: ['b@example.com'] };
    const out = markVoucherSent(makeVoucher(), recipients, '2026-06-30T12:00:00.000Z');
    expect(out.status).toBe('sent');
    expect(out.sentAt).toBe('2026-06-30T12:00:00.000Z');
    expect(out.recipients).toEqual(recipients);
  });
});
