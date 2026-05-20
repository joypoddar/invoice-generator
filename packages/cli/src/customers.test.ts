import { describe, expect, it } from 'vitest';
import { ConfigSchema, type Config } from '@invoice/shared';
import {
  customerExists,
  deleteCustomer,
  getCustomer,
  listCustomers,
  setCustomer,
  slugFor,
  type CustomerData,
} from './customers.js';

function baseConfig(): Config {
  return ConfigSchema.parse({
    name: 'Joy',
    email: 'joy@creowis.com',
    smtp: { host: 'smtp.gmail.com', port: 465, user: 'joy@creowis.com' },
    imap: { host: 'imap.gmail.com', port: 993, user: 'joy@creowis.com', folder: 'INBOX' },
    mail: { recipients: { to: ['hello@creowis.com'] } },
  });
}

function customer(name: string, overrides: Partial<CustomerData> = {}): CustomerData {
  return {
    name,
    defaultRecipientTo: [],
    defaultRecipientCc: [],
    ...overrides,
  };
}

describe('slugFor', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugFor('Acme Corp')).toBe('acme-corp');
  });

  it('strips punctuation', () => {
    expect(slugFor('Globex, Inc.')).toBe('globex-inc');
  });

  it('collapses multiple separators', () => {
    expect(slugFor('Hello   World!!!')).toBe('hello-world');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugFor('  Trailing  ')).toBe('trailing');
    expect(slugFor('---weird---')).toBe('weird');
  });

  it('handles unicode by stripping non-alphanumeric', () => {
    expect(slugFor('Café Müller')).toBe('caf-m-ller');
  });
});

describe('listCustomers', () => {
  it('returns an empty array when no customers configured', () => {
    expect(listCustomers(baseConfig())).toEqual([]);
  });

  it('sorts entries by display name', () => {
    const cfg = setCustomer(
      setCustomer(setCustomer(baseConfig(), 'globex', customer('Globex')), 'acme', customer('Acme')),
      'zeta',
      customer('Zeta'),
    );
    const names = listCustomers(cfg).map(([, c]) => c.name);
    expect(names).toEqual(['Acme', 'Globex', 'Zeta']);
  });
});

describe('getCustomer', () => {
  const cfg = setCustomer(baseConfig(), 'acme-corp', customer('Acme Corp'));

  it('finds by slug', () => {
    expect(getCustomer(cfg, 'acme-corp')?.name).toBe('Acme Corp');
  });

  it('finds by display name (case-insensitive)', () => {
    expect(getCustomer(cfg, 'Acme Corp')?.name).toBe('Acme Corp');
    expect(getCustomer(cfg, 'acme corp')?.name).toBe('Acme Corp');
    expect(getCustomer(cfg, 'ACME CORP')?.name).toBe('Acme Corp');
  });

  it('returns null when neither slug nor name matches', () => {
    expect(getCustomer(cfg, 'nonexistent')).toBeNull();
    expect(getCustomer(cfg, '')).toBeNull();
  });

  it('does not coerce partial matches', () => {
    expect(getCustomer(cfg, 'Acme')).toBeNull();
    expect(getCustomer(cfg, 'corp')).toBeNull();
  });
});

describe('setCustomer / deleteCustomer', () => {
  it('setCustomer adds a new record', () => {
    const cfg = baseConfig();
    const next = setCustomer(cfg, 'acme-corp', customer('Acme Corp'));
    expect(next.customers['acme-corp']?.name).toBe('Acme Corp');
    expect(cfg.customers['acme-corp']).toBeUndefined();
  });

  it('setCustomer overwrites an existing record', () => {
    let cfg = baseConfig();
    cfg = setCustomer(cfg, 'acme', customer('Acme', { email: 'old@acme.com' }));
    cfg = setCustomer(cfg, 'acme', customer('Acme', { email: 'new@acme.com' }));
    expect(cfg.customers['acme']?.email).toBe('new@acme.com');
  });

  it('deleteCustomer removes the matching record', () => {
    let cfg = setCustomer(baseConfig(), 'acme', customer('Acme'));
    cfg = deleteCustomer(cfg, 'acme');
    expect(cfg.customers['acme']).toBeUndefined();
  });

  it('deleteCustomer is a no-op when the slug is unknown', () => {
    const cfg = setCustomer(baseConfig(), 'acme', customer('Acme'));
    const next = deleteCustomer(cfg, 'globex');
    expect(next).toBe(cfg);
  });
});

describe('customerExists', () => {
  it('returns true for known slug or name', () => {
    const cfg = setCustomer(baseConfig(), 'acme', customer('Acme'));
    expect(customerExists(cfg, 'acme')).toBe(true);
    expect(customerExists(cfg, 'Acme')).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(customerExists(baseConfig(), 'acme')).toBe(false);
  });
});
