import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { resolveInvoice } from './resolver.js';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: randomUUID(),
    default: {
      invoiceNumber: `INV-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fromName: 'Sender',
      fromEmail: 'sender@example.com',
      customerName: 'Customer',
      customerEmail: '',
      issueDate: '2026-05-17',
      dueDate: '2026-06-17',
      currency: 'USD',
      lineItems: [{ description: 'Item', quantity: 1, unitPrice: 100 }],
      notes: '',
    },
    custom: {},
    status: 'draft',
    paymentStatus: 'unpaid',
    ...overrides,
  };
}

describe('resolveInvoice', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('resolves by exact full UUID', async () => {
    const inv = makeInvoice();
    await store.upsert(inv);
    const result = await resolveInvoice(store, inv.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.invoice.id).toBe(inv.id);
  });

  it('resolves by short id prefix (first 8 chars)', async () => {
    const inv = makeInvoice();
    await store.upsert(inv);
    const prefix = inv.id.slice(0, 8);
    const result = await resolveInvoice(store, prefix);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.invoice.id).toBe(inv.id);
  });

  it('resolves by invoice number exact match', async () => {
    const inv = makeInvoice({
      default: { ...makeInvoice().default, invoiceNumber: 'INV-2026-0042' },
    });
    await store.upsert(inv);
    const result = await resolveInvoice(store, 'INV-2026-0042');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.invoice.id).toBe(inv.id);
  });

  it('returns not-found for an unknown reference', async () => {
    await store.upsert(makeInvoice());
    const result = await resolveInvoice(store, 'does-not-exist');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('returns not-found for very short non-hex refs', async () => {
    // "x" is too short to be a UUID prefix and doesn't match any invoice number
    await store.upsert(makeInvoice());
    const result = await resolveInvoice(store, 'x');
    expect(result.ok).toBe(false);
  });

  it('rejects sub-4-char prefix that would otherwise match', async () => {
    // Even if a UUID happens to start with "ab", we won't match — too short to disambiguate.
    const inv = makeInvoice({ id: 'ab123456-7890-aaaa-bbbb-cccccccccccc' });
    await store.upsert(inv);
    const result = await resolveInvoice(store, 'ab');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });

  it('still resolves short invoice numbers even below 4 chars', async () => {
    const inv = makeInvoice({
      default: { ...makeInvoice().default, invoiceNumber: '42' },
    });
    await store.upsert(inv);
    const result = await resolveInvoice(store, '42');
    expect(result.ok).toBe(true);
  });

  it('returns ambiguous when two invoices share an invoice number', async () => {
    // E.g. after a mid-flight numberFormat change creating a collision
    const num = 'INV-2026-0001';
    const inv1 = makeInvoice({
      default: { ...makeInvoice().default, invoiceNumber: num, customerName: 'Acme' },
    });
    const inv2 = makeInvoice({
      default: { ...makeInvoice().default, invoiceNumber: num, customerName: 'Globex' },
    });
    await store.upsert(inv1);
    await store.upsert(inv2);

    const result = await resolveInvoice(store, num);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('ambiguous');
      if (result.reason === 'ambiguous') {
        expect(result.matches).toHaveLength(2);
      }
    }
  });

  it('returns ambiguous when a prefix matches multiple UUIDs', async () => {
    const inv1 = makeInvoice({ id: 'abcd1111-aaaa-bbbb-cccc-dddddddddddd' });
    const inv2 = makeInvoice({ id: 'abcd2222-aaaa-bbbb-cccc-dddddddddddd' });
    await store.upsert(inv1);
    await store.upsert(inv2);

    const result = await resolveInvoice(store, 'abcd');
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'ambiguous') {
      expect(result.matches).toHaveLength(2);
    }
  });

  it('full UUID takes precedence even when shorter refs would also match', async () => {
    // Two invoices: one whose ID matches the other's invoice-number value.
    // The full UUID lookup should win cleanly.
    const inv1 = makeInvoice({ id: 'abcd0000-aaaa-bbbb-cccc-dddddddddddd' });
    const inv2 = makeInvoice({
      default: { ...makeInvoice().default, invoiceNumber: 'abcd0000-aaaa-bbbb-cccc-dddddddddddd' },
    });
    await store.upsert(inv1);
    await store.upsert(inv2);

    const result = await resolveInvoice(store, 'abcd0000-aaaa-bbbb-cccc-dddddddddddd');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.invoice.id).toBe(inv1.id);
  });
});
