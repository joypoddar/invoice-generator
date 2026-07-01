import { describe, expect, it } from 'vitest';
import type { Voucher } from '@invoice/shared';
import { renderVoucherListPage } from './voucher-list.js';

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 'v1',
    voucherNumber: 'JP_May26_01',
    title: 'Employee Payment Voucher',
    payTo: 'Github Copilot',
    date: '2026-05-07',
    currency: 'INR',
    lines: [{ paymentMethod: 'Credit Card', description: 'Subscription', amount: 186 }],
    preparedBy: 'Joy Poddar',
    receivedBy: 'Joy Poddar',
    createdAt: '2026-05-07T00:00:00.000Z',
    status: 'sent',
    paymentStatus: 'unpaid',
    ...overrides,
  };
}

describe('renderVoucherListPage', () => {
  it('renders an empty-state message when no vouchers exist', () => {
    const html = renderVoucherListPage([]);
    expect(html).toContain('No vouchers yet');
    expect(html).toContain('invoice voucher new');
  });

  it('renders one row per voucher linking to /vouchers/:id', () => {
    const v = makeVoucher();
    const html = renderVoucherListPage([v]);
    expect(html).toContain(`href="/vouchers/${v.id}"`);
    expect(html).toContain('JP_May26_01');
    expect(html).toContain('Github Copilot');
  });

  it('renders a paid/unpaid status badge', () => {
    expect(renderVoucherListPage([makeVoucher({ paymentStatus: 'paid' })])).toContain('badge-paid');
    expect(renderVoucherListPage([makeVoucher()])).toContain('badge-unpaid');
  });

  it('renders a checkbox column with a select-all in the header', () => {
    const html = renderVoucherListPage([makeVoucher()]);
    expect(html).toContain('id="select-all"');
    expect(html).toMatch(/<input type="checkbox" name="voucher" value="[^"]+"/);
  });

  it('renders a sticky "Print selected" button (disabled by default)', () => {
    const html = renderVoucherListPage([makeVoucher()]);
    expect(html).toContain('id="print-selected"');
    expect(html).toMatch(/<button[^>]*id="print-selected"[^>]*disabled/);
    expect(html).toContain('Print selected');
  });

  it('inline script navigates to /vouchers/print?ids= and enforces the 50-cap', () => {
    const html = renderVoucherListPage([makeVoucher()]);
    expect(html).toContain('/vouchers/print?ids=');
    expect(html).toMatch(/Only the first 50 will be printed/);
  });
});
