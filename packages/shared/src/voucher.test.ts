import { describe, expect, it } from 'vitest';
import { renderVoucherNumber, voucherTotal, type Voucher } from './voucher.js';

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
