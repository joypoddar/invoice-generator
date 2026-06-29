import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Voucher } from '@invoice/shared';
import { renderVoucherCard, renderVoucherHtml } from './voucher-html.js';

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    id: 'v1',
    voucherNumber: 'JP_May26_02',
    title: 'Employee Payment Voucher',
    payTo: 'Github Copilot',
    date: '2026-05-07',
    currency: 'INR',
    lines: [{ paymentMethod: 'Credit Card', description: 'Delhivery', amount: 186 }],
    companyName: 'CreoWis Technologies Private Limited',
    companyAddress: '360, 2nd cross, Bangalore 560100',
    preparedBy: 'Joy Poddar',
    receivedBy: 'Joy Poddar',
    createdAt: '2026-05-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('renderVoucherCard', () => {
  it('renders the title, payee, number and company header', () => {
    const html = renderVoucherCard(makeVoucher());
    expect(html).toContain('Employee Payment Voucher');
    expect(html).toContain('Github Copilot');
    expect(html).toContain('JP_May26_02');
    expect(html).toContain('CreoWis Technologies Private Limited');
    expect(html).toContain('360, 2nd cross, Bangalore 560100');
  });

  it('renders the line item columns and total', () => {
    const html = renderVoucherCard(makeVoucher());
    expect(html).toContain('Serial Number');
    expect(html).toContain('Payment Method');
    expect(html).toContain('Credit Card');
    expect(html).toContain('Delhivery');
    expect(html).toContain('Total');
  });

  it('renders the amount in words', () => {
    const html = renderVoucherCard(makeVoucher());
    expect(html).toContain('Amount in Words:');
    expect(html).toContain('Rupees One hundred and eighty six only.');
  });

  it('renders prepared-by and received-by', () => {
    const html = renderVoucherCard(makeVoucher());
    expect(html).toContain('Prepared By: Joy Poddar');
    expect(html).toContain('Received By: Joy Poddar');
  });

  it('pads to a minimum of 5 body rows for short vouchers', () => {
    const html = renderVoucherCard(makeVoucher());
    // 1 data row + 4 fillers = 5 body rows (each filler cell uses &nbsp;)
    const fillerCount = (html.match(/&nbsp;/g) ?? []).length;
    expect(fillerCount).toBeGreaterThanOrEqual(4 * 4);
  });

  it('escapes HTML in user-supplied fields', () => {
    const html = renderVoucherCard(makeVoucher({ payTo: '<script>x</script>' }));
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('embeds a readable logo and omits an unreadable one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voucher-'));
    const logo = join(dir, 'logo.png');
    writeFileSync(logo, 'PNG');
    const withLogo = renderVoucherCard(makeVoucher(), { branding: { logoUrl: logo } });
    expect(withLogo).toContain('data:image/png;base64,');

    const noLogo = renderVoucherCard(makeVoucher(), { branding: { logoUrl: '/no/such.png' } });
    expect(noLogo).not.toContain('<img');
  });
});

describe('renderVoucherHtml', () => {
  it('wraps the card with a document and a slugified title', () => {
    const html = renderVoucherHtml(makeVoucher());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>github_copilot_voucher_jp_may26_02</title>');
    // print CSS for chrome-free PDF
    expect(html).toContain('@page');
  });
});
