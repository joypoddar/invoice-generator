import { describe, expect, it } from 'vitest';
import {
  prepareVoucherClone,
  renderVoucherNumber,
  voucherPaymentStatus,
  voucherTotal,
  type Voucher,
} from './voucher.js';

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

describe('renderVoucherNumber', () => {
  // May = month index 4; use UTC noon so local TZ can't shift the day/month.
  const date = new Date('2026-05-07T12:00:00Z');

  it('substitutes the default format', () => {
    expect(renderVoucherNumber('{INITIALS}_{MMM}{YY}_{SEQ}', 2, date, 'JP')).toBe('JP_May26_02');
  });

  it('zero-pads {SEQ} to two digits', () => {
    expect(renderVoucherNumber('{SEQ}', 5, date)).toBe('05');
    expect(renderVoucherNumber('{SEQ}', 42, date)).toBe('42');
    expect(renderVoucherNumber('{SEQ}', 100, date)).toBe('100');
  });

  it('handles {MMMM}, {MM}, {YYYY}, {YY}, {DD} without clobbering each other', () => {
    expect(renderVoucherNumber('{MMMM}-{MMM}-{MM}-{DD}-{YYYY}-{YY}', 1, date)).toBe(
      'May-May-05-07-2026-26',
    );
  });

  it('renders empty initials when none provided', () => {
    expect(renderVoucherNumber('{INITIALS}_{SEQ}', 1, date)).toBe('_01');
  });
});

describe('voucherTotal', () => {
  it('sums the line amounts', () => {
    const v = makeVoucher({
      lines: [
        { paymentMethod: 'Cash', description: 'a', amount: 100 },
        { paymentMethod: 'Card', description: 'b', amount: 86.5 },
      ],
    });
    expect(voucherTotal(v)).toBe(186.5);
  });

  it('returns 0 with no lines', () => {
    expect(voucherTotal(makeVoucher({ lines: [] }))).toBe(0);
  });
});

describe('voucherPaymentStatus', () => {
  it('defaults to unpaid when absent (pre-status-tracking rows)', () => {
    expect(voucherPaymentStatus(makeVoucher())).toBe('unpaid');
  });

  it('returns the stored status when set', () => {
    expect(voucherPaymentStatus(makeVoucher({ paymentStatus: 'paid' }))).toBe('paid');
    expect(voucherPaymentStatus(makeVoucher({ paymentStatus: 'unpaid' }))).toBe('unpaid');
  });
});

describe('prepareVoucherClone', () => {
  const source = makeVoucher({
    status: 'sent',
    sentAt: '2026-05-07T12:00:00.000Z',
    recipients: { to: ['a@example.com'] },
    paymentStatus: 'paid',
    paidAt: '2026-05-08T00:00:00.000Z',
    customerSlug: 'github',
    notes: 'thanks',
  });
  const clone = prepareVoucherClone(source, {
    id: 'v2',
    voucherNumber: 'JP_May26_02',
    date: '2026-06-30',
    createdAt: '2026-06-30T00:00:00.000Z',
  });

  it('replaces identity (id, number, date, createdAt)', () => {
    expect(clone.id).toBe('v2');
    expect(clone.voucherNumber).toBe('JP_May26_02');
    expect(clone.date).toBe('2026-06-30');
    expect(clone.createdAt).toBe('2026-06-30T00:00:00.000Z');
  });

  it('resets send + payment state to a fresh draft', () => {
    expect(clone.status).toBe('draft');
    expect(clone.paymentStatus).toBe('unpaid');
    expect(clone.sentAt).toBeUndefined();
    expect(clone.recipients).toBeUndefined();
    expect(clone.paidAt).toBeUndefined();
  });

  it('preserves payee, customer link, lines, signatories and notes', () => {
    expect(clone.payTo).toBe(source.payTo);
    expect(clone.customerSlug).toBe('github');
    expect(clone.lines).toEqual(source.lines);
    expect(clone.preparedBy).toBe(source.preparedBy);
    expect(clone.receivedBy).toBe(source.receivedBy);
    expect(clone.notes).toBe('thanks');
  });
});
