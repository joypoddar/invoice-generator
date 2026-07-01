import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Voucher } from '@invoice/shared';
import { SqliteStore } from './sqlite-store.js';

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
    ...overrides,
  };
}

describe('SqliteStore vouchers', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('upsertVoucher then getVoucher round-trips', () => {
    const v = makeVoucher();
    store.upsertVoucher(v);
    expect(store.getVoucher(v.id)).toEqual(v);
  });

  it('getVoucher returns null for an unknown id', () => {
    expect(store.getVoucher('nope')).toBeNull();
  });

  it('upsert updates an existing voucher', () => {
    store.upsertVoucher(makeVoucher());
    store.upsertVoucher(makeVoucher({ payTo: 'Updated Payee' }));
    expect(store.getVoucher('v1')?.payTo).toBe('Updated Payee');
    expect(store.listVouchers()).toHaveLength(1);
  });

  it('listVouchers sorts by date desc', () => {
    store.upsertVoucher(makeVoucher({ id: 'a', date: '2026-05-01' }));
    store.upsertVoucher(makeVoucher({ id: 'b', date: '2026-06-01' }));
    expect(store.listVouchers().map((v) => v.id)).toEqual(['b', 'a']);
  });

  it('deleteVoucher removes the row', () => {
    store.upsertVoucher(makeVoucher());
    expect(store.deleteVoucher('v1')).toBe(true);
    expect(store.getVoucher('v1')).toBeNull();
    expect(store.deleteVoucher('v1')).toBe(false);
  });

  it('voucher watermark round-trips and is independent of the invoice watermark', () => {
    expect(store.getVoucherLastUid()).toBe(0);
    store.setVoucherLastUid(42);
    expect(store.getVoucherLastUid()).toBe(42);

    // Setting the invoice watermark must not move the voucher watermark, and vice versa.
    store.setLastUid(99);
    expect(store.getVoucherLastUid()).toBe(42);
    expect(store.getLastUid()).toBe(99);
  });
});
