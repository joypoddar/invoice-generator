import { describe, expect, it } from 'vitest';
import { ConfigSchema, type Config } from '@invoice/shared';
import { initialsFor, resolveVoucherNumberSpec } from './voucher-number.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return ConfigSchema.parse({
    name: 'Joy Poddar',
    email: 'joy@example.com',
    imap: { host: 'imap.example.com', port: 993, user: 'joy@example.com', folder: 'Sent' },
    ...overrides,
  });
}

describe('initialsFor', () => {
  it('takes the first letter of each word, uppercased', () => {
    expect(initialsFor('Joy Poddar')).toBe('JP');
    expect(initialsFor('joy poddar dhar')).toBe('JPD');
    expect(initialsFor('  Acme   Corp ')).toBe('AC');
  });
});

describe('resolveVoucherNumberSpec', () => {
  it('reads format, seq and initials from config', () => {
    const spec = resolveVoucherNumberSpec(makeConfig());
    expect(spec.format).toBe('{INITIALS}_{MMM}{YY}_{SEQ}');
    expect(spec.seq).toBe(1);
    expect(spec.initials).toBe('JP');
  });

  it('reflects a custom format and advanced counter', () => {
    const config = makeConfig();
    config.voucher.numberFormat = 'PV-{YYYY}-{SEQ}';
    config.voucher.nextSeq = 7;
    const spec = resolveVoucherNumberSpec(config);
    expect(spec.format).toBe('PV-{YYYY}-{SEQ}');
    expect(spec.seq).toBe(7);
  });

  it('uses a billing-to customer counter when available', () => {
    const config = makeConfig();
    config.customers = {
      acme: {
        name: 'Acme Corp',
        address: 'Mumbai',
        defaultRecipientTo: [],
        defaultRecipientCc: [],
        nextSeq: 42,
      },
    };

    const spec = resolveVoucherNumberSpec(config, 'acme');
    expect(spec.format).toBe('{INITIALS}_{MMM}{YY}_{SEQ}');
    expect(spec.seq).toBe(42);
  });
});
