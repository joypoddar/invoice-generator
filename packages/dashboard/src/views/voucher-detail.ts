import { renderVoucherHtml, type RenderOpts } from '@invoice/renderer';
import type { Voucher } from '@invoice/shared';

/**
 * Wrap `renderVoucherHtml` with a sticky no-print toolbar. Mirrors
 * `renderInvoiceDetailPage`; the Print button works because this is a real
 * browser context.
 */
export function renderVoucherDetailPage(voucher: Voucher, opts?: RenderOpts): string {
  return injectToolbar(renderVoucherHtml(voucher, opts));
}

const TOOLBAR_HTML = `<div class="no-print" style="position:sticky; top:0; z-index:10;
  background:#fff; border-bottom:1px solid #e5e7eb; padding:14px 24px;
  display:flex; gap:12px; align-items:center; font-family:'Segoe UI',Arial,sans-serif;">
  <a href="/vouchers" style="color:#3949ab; text-decoration:none; font-size:14px;">← All vouchers</a>
  <span style="flex:1;"></span>
  <button onclick="window.print()" style="background:#3949ab; color:#fff;
    border:none; padding:9px 18px; border-radius:6px; font-size:14px;
    font-weight:600; cursor:pointer;">
    🖨 Print / Save as PDF
  </button>
</div>`;

function injectToolbar(html: string): string {
  return html.replace(/<body([^>]*)>/, `<body$1>\n${TOOLBAR_HTML}`);
}
