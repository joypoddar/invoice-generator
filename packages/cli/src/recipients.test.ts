import { describe, expect, it } from 'vitest';
import { ConfigSchema, type Config, type Invoice } from '@invoice/shared';
import { setCustomer } from './customers.js';
import { composeRecipients } from './recipients.js';

function baseConfig(): Config {
  return ConfigSchema.parse({
    name: 'Joy',
    email: 'joy@creowis.com',
    smtp: { host: 'smtp.gmail.com', port: 465, user: 'joy@creowis.com' },
    imap: { host: 'imap.gmail.com', port: 993, user: 'joy@creowis.com', folder: 'INBOX' },
    mail: {
      recipients: {
        to: ['hello@creowis.com'],
        cc: ['team@creowis.com'],
        bcc: ['archive@creowis.com'],
      },
    },
  });
}

function invoiceWith(slug?: string): Invoice {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    default: slug ? { customerSlug: slug } : {},
    custom: {},
    status: 'draft',
    paymentStatus: 'unpaid',
  };
}

describe('composeRecipients', () => {
  it('falls back to the global recipients when no customer slug is set', () => {
    const cfg = baseConfig();
    const r = composeRecipients(cfg, invoiceWith());
    expect(r.to).toEqual(['hello@creowis.com']);
    expect(r.cc).toEqual(['team@creowis.com']);
    expect(r.bcc).toEqual(['archive@creowis.com']);
  });

  it('uses the customer defaults when the slug resolves and has them', () => {
    const cfg = setCustomer(baseConfig(), 'acme', {
      name: 'Acme',
      defaultRecipientTo: ['pay@acme.com', 'finance@acme.com'],
      defaultRecipientCc: ['cc@acme.com'],
    });
    const r = composeRecipients(cfg, invoiceWith('acme'));
    expect(r.to).toEqual(['pay@acme.com', 'finance@acme.com']);
    expect(r.cc).toEqual(['cc@acme.com']);
    expect(r.bcc).toEqual(['archive@creowis.com']);
  });

  it('falls back to the global recipients when the customer has empty defaults', () => {
    const cfg = setCustomer(baseConfig(), 'acme', {
      name: 'Acme',
      defaultRecipientTo: [],
      defaultRecipientCc: [],
    });
    const r = composeRecipients(cfg, invoiceWith('acme'));
    expect(r.to).toEqual(['hello@creowis.com']);
    expect(r.cc).toEqual(['team@creowis.com']);
  });

  it('overrides win over both customer and global defaults', () => {
    const cfg = setCustomer(baseConfig(), 'acme', {
      name: 'Acme',
      defaultRecipientTo: ['pay@acme.com'],
      defaultRecipientCc: ['cc@acme.com'],
    });
    const r = composeRecipients(cfg, invoiceWith('acme'), {
      to: ['adhoc@example.com'],
      cc: [],
      bcc: ['boss@example.com'],
    });
    expect(r.to).toEqual(['adhoc@example.com']);
    expect(r.cc).toEqual([]);
    expect(r.bcc).toEqual(['boss@example.com']);
  });

  it('falls back gracefully when the customer was deleted', () => {
    const cfg = baseConfig();
    const r = composeRecipients(cfg, invoiceWith('vanished'));
    expect(r.to).toEqual(['hello@creowis.com']);
    expect(r.cc).toEqual(['team@creowis.com']);
  });
});
