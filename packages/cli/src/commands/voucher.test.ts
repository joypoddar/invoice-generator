import { describe, expect, it } from 'vitest';
import type { Config } from '@invoice/shared';
import { resolveVoucherCompanyInfo } from './voucher.js';

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
