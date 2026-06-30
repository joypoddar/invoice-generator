import { describe, expect, it } from 'vitest';
import type { Voucher } from '@invoice/shared';
import { BATCH_CAP, renderVoucherBatchPage } from './voucher-batch.js';

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

describe('renderVoucherBatchPage', () => {
  it('reuses the 50-item batch cap', () => {
    expect(BATCH_CAP).toBe(50);
  });

  it('renders a single voucher without a page-break wrapper', () => {
    const html = renderVoucherBatchPage([makeVoucher()], {
      localUserName: 'Joy Poddar',
      today: '2026-06-30',
    });
    expect(html).toContain('class="voucher-card"');
    expect(html).not.toContain('page-break-before: always');
  });

  it('renders multiple vouchers with page-break-before between them', () => {
    const html = renderVoucherBatchPage(
      [makeVoucher({ id: 'a' }), makeVoucher({ id: 'b' }), makeVoucher({ id: 'c' })],
      { localUserName: 'Joy Poddar', today: '2026-06-30' },
    );
    expect(html.match(/class="voucher-card"/g)?.length).toBe(3);
    expect(html.match(/page-break-before:\s*always/g)?.length).toBe(2);
  });

  it('auto-fires window.print() via a setTimeout after load', () => {
    const html = renderVoucherBatchPage([makeVoucher()], {
      localUserName: 'Joy Poddar',
      today: '2026-06-30',
    });
    expect(html).toMatch(/setTimeout\([\s\S]*?window\.print\(\)/);
  });

  it('builds the document title from the local user and date', () => {
    const html = renderVoucherBatchPage([makeVoucher()], {
      localUserName: 'Joy Poddar',
      today: '2026-06-30',
    });
    expect(html).toContain('<title>joy_poddar_vouchers_2026-06-30</title>');
  });

  it('falls back to vouchers_<date> when the local user name is empty', () => {
    const html = renderVoucherBatchPage([makeVoucher()], {
      localUserName: '',
      today: '2026-06-30',
    });
    expect(html).toContain('<title>vouchers_2026-06-30</title>');
  });
});
