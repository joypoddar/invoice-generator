import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import { SqliteStore } from './sqlite-store.js';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: randomUUID(),
    default: {
      invoiceNumber: 'INV-2026-0001',
      fromName: 'Joy',
      fromEmail: 'joy@creowis.com',
      customerName: 'Acme',
      customerEmail: 'pay@acme.com',
      issueDate: '2026-05-17',
      dueDate: '2026-06-17',
      currency: 'USD',
      lineItems: [{ description: 'Consulting', quantity: 5, unitPrice: 150 }],
      notes: '',
    },
    custom: {},
    status: 'draft',
    paymentStatus: 'unpaid',
    ...overrides,
  };
}

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('upsert then get returns the same invoice', async () => {
    const inv = makeInvoice();
    await store.upsert(inv);
    const got = await store.get(inv.id);
    expect(got).toEqual(inv);
  });

  it('get returns null for unknown id', async () => {
    expect(await store.get('does-not-exist')).toBeNull();
  });

  it('upsert is idempotent — calling twice with same id updates, does not duplicate', async () => {
    const inv = makeInvoice();
    await store.upsert(inv);
    await store.upsert({ ...inv, status: 'sent', sentAt: '2026-05-18T10:00:00Z' });
    expect(await store.count()).toBe(1);
    const got = await store.get(inv.id);
    expect(got?.status).toBe('sent');
    expect(got?.sentAt).toBe('2026-05-18T10:00:00Z');
  });

  it('upsert with messageUid sets the IMAP UID; later upsert without it preserves the UID', async () => {
    const inv = makeInvoice();
    await store.upsert(inv);
    await store.upsert(inv, { messageUid: 'imap-uid-42' });
    await store.upsert(inv); // no UID provided
    expect(await store.count()).toBe(1);
    // Trying to upsert a different invoice with the SAME messageUid should fail UNIQUE constraint
    const inv2 = makeInvoice();
    await expect(store.upsert(inv2, { messageUid: 'imap-uid-42' })).rejects.toThrow();
  });

  it('list returns all upserted invoices', async () => {
    await store.upsert(makeInvoice());
    await store.upsert(makeInvoice());
    await store.upsert(makeInvoice());
    expect(await store.count()).toBe(3);
    const all = await store.list();
    expect(all).toHaveLength(3);
  });

  it('filters by paymentStatus', async () => {
    await store.upsert(makeInvoice({ paymentStatus: 'paid', paidAt: '2026-05-20' }));
    await store.upsert(makeInvoice({ paymentStatus: 'unpaid' }));
    await store.upsert(makeInvoice({ paymentStatus: 'unpaid' }));
    expect((await store.list({ paymentStatus: 'paid' })).length).toBe(1);
    expect((await store.list({ paymentStatus: 'unpaid' })).length).toBe(2);
  });

  it('filters by hasCustomFields', async () => {
    await store.upsert(makeInvoice());
    await store.upsert(makeInvoice({ custom: { purchaseOrderNumber: 'PO-123' } }));
    expect((await store.list({ hasCustomFields: true })).length).toBe(1);
    expect((await store.list({ hasCustomFields: false })).length).toBe(1);
  });

  it('filters by overdue (unpaid AND due_date < today)', async () => {
    await store.upsert(
      makeInvoice({
        default: { ...makeInvoice().default, dueDate: '2020-01-01' },
        paymentStatus: 'unpaid',
      }),
    );
    await store.upsert(
      makeInvoice({
        default: { ...makeInvoice().default, dueDate: '2020-01-01' },
        paymentStatus: 'paid',
        paidAt: '2020-02-01',
      }),
    );
    await store.upsert(
      makeInvoice({
        default: { ...makeInvoice().default, dueDate: '2099-01-01' },
        paymentStatus: 'unpaid',
      }),
    );
    const overdue = await store.list({ overdue: true });
    expect(overdue.length).toBe(1);
  });

  it('filters by text across number, customer, raw_json', async () => {
    await store.upsert(
      makeInvoice({
        default: { ...makeInvoice().default, invoiceNumber: 'CREOWIS-2026-AK-0042' },
      }),
    );
    await store.upsert(
      makeInvoice({
        default: { ...makeInvoice().default, customerName: 'Globex' },
      }),
    );
    expect((await store.list({ text: 'AK-0042' })).length).toBe(1);
    expect((await store.list({ text: 'Globex' })).length).toBe(1);
    expect((await store.list({ text: 'NoMatch' })).length).toBe(0);
  });

  it('sorts by the requested field and direction', async () => {
    await store.upsert(
      makeInvoice({ default: { ...makeInvoice().default, dueDate: '2026-06-01' } }),
    );
    await store.upsert(
      makeInvoice({ default: { ...makeInvoice().default, dueDate: '2026-01-01' } }),
    );
    await store.upsert(
      makeInvoice({ default: { ...makeInvoice().default, dueDate: '2026-12-01' } }),
    );
    const asc = await store.list(undefined, { field: 'dueDate', direction: 'asc' });
    expect(asc.map((i) => i.default.dueDate)).toEqual(['2026-01-01', '2026-06-01', '2026-12-01']);
    const desc = await store.list(undefined, { field: 'dueDate', direction: 'desc' });
    expect(desc.map((i) => i.default.dueDate)).toEqual(['2026-12-01', '2026-06-01', '2026-01-01']);
  });

  it('delete removes a row', async () => {
    const inv = makeInvoice();
    await store.upsert(inv);
    expect(await store.count()).toBe(1);
    await store.delete(inv.id);
    expect(await store.count()).toBe(0);
    expect(await store.get(inv.id)).toBeNull();
  });

  it('aggregate() throws in Phase 1', async () => {
    await expect(store.aggregate({ kind: 'totalsByStatus' })).rejects.toThrow(/not implemented/);
  });

  it('getLastUid / setLastUid roundtrip', () => {
    expect(store.getLastUid()).toBe(0);
    store.setLastUid(42);
    expect(store.getLastUid()).toBe(42);
    store.setLastUid(99);
    expect(store.getLastUid()).toBe(99);
  });
});
