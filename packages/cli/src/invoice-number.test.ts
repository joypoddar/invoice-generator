import { describe, expect, it } from 'vitest';
import { ConfigSchema, type Config } from '@invoice/shared';
import { resolveNumberSpec } from './invoice-number.js';

function baseConfig(overrides: Partial<{ companyName: string; numberFormat: string; nextSeq: number }> = {}): Config {
  return ConfigSchema.parse({
    name: 'Joy',
    email: 'joy@creowis.com',
    smtp: { host: 's', port: 1, user: 'u' },
    imap: { host: 's', port: 1, user: 'u', folder: 'INBOX' },
    mail: { recipients: { to: ['hello@creowis.com'] } },
    company: overrides.companyName ? { name: overrides.companyName } : {},
    invoice: {
      numberFormat: overrides.numberFormat ?? 'INV-{YYYY}-{SEQ}',
      nextSeq: overrides.nextSeq ?? 7,
    },
  });
}

function withCustomer(
  cfg: Config,
  slug: string,
  data: {
    name: string;
    numberFormat?: string;
    nextSeq?: number;
  },
): Config {
  return {
    ...cfg,
    customers: {
      ...cfg.customers,
      [slug]: {
        name: data.name,
        defaultRecipientTo: [],
        defaultRecipientCc: [],
        nextSeq: data.nextSeq ?? 1,
        ...(data.numberFormat ? { numberFormat: data.numberFormat } : {}),
      },
    },
  };
}

describe('resolveNumberSpec', () => {
  it('returns the global spec when no slug is passed', () => {
    const cfg = baseConfig({ companyName: 'Creowis', numberFormat: 'INV-{YYYY}-{SEQ}', nextSeq: 7 });
    const spec = resolveNumberSpec(cfg, undefined);
    expect(spec.format).toBe('INV-{YYYY}-{SEQ}');
    expect(spec.seq).toBe(7);
    expect(spec.companyName).toBe('Creowis');
    expect(spec.customerSlug).toBeUndefined();
  });

  it('returns the customer spec when the slug has a numberFormat', () => {
    const cfg = withCustomer(baseConfig(), 'acme', {
      name: 'Acme Corp',
      numberFormat: 'ACME-{YYYY}-{SEQ}',
      nextSeq: 42,
    });
    const spec = resolveNumberSpec(cfg, 'acme');
    expect(spec.format).toBe('ACME-{YYYY}-{SEQ}');
    expect(spec.seq).toBe(42);
    expect(spec.companyName).toBe('Acme Corp');
    expect(spec.customerSlug).toBe('acme');
  });

  it('falls back to the global spec when the customer has no numberFormat', () => {
    const cfg = withCustomer(baseConfig({ nextSeq: 7 }), 'acme', { name: 'Acme', nextSeq: 99 });
    const spec = resolveNumberSpec(cfg, 'acme');
    expect(spec.format).toBe('INV-{YYYY}-{SEQ}');
    expect(spec.seq).toBe(7);
    expect(spec.customerSlug).toBeUndefined();
  });

  it('falls back to the global spec for an unknown slug', () => {
    const cfg = baseConfig({ nextSeq: 7 });
    const spec = resolveNumberSpec(cfg, 'ghost');
    expect(spec.format).toBe('INV-{YYYY}-{SEQ}');
    expect(spec.seq).toBe(7);
    expect(spec.customerSlug).toBeUndefined();
  });

  it('treats an empty-string numberFormat as "no override" and falls back to global', () => {
    const cfg = withCustomer(baseConfig(), 'acme', { name: 'Acme', numberFormat: '', nextSeq: 99 });
    const spec = resolveNumberSpec(cfg, 'acme');
    expect(spec.format).toBe('INV-{YYYY}-{SEQ}');
    expect(spec.customerSlug).toBeUndefined();
  });
});
