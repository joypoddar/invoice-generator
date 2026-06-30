import {
  PRINT_CSS,
  VOUCHER_PRINT_EXTRA,
  renderVoucherCard,
  slugify,
  type RenderOpts,
} from '@invoice/renderer';
import type { Voucher } from '@invoice/shared';
import { BATCH_CAP } from './invoice-batch.js';

export { BATCH_CAP };

export interface VoucherBatchPageOptions {
  /** Identity of whoever is printing (the local install's `config.name`); drives the <title>. */
  localUserName: string;
  renderOpts?: RenderOpts;
  /** Override "today" for deterministic test output. ISO date `YYYY-MM-DD`. */
  today?: string;
}

/**
 * Render multiple vouchers stacked into a single document, each on its own
 * printed page. Auto-fires `window.print()` 100ms after load. Mirrors
 * `renderInvoiceBatchPage`.
 */
export function renderVoucherBatchPage(vouchers: Voucher[], opts: VoucherBatchPageOptions): string {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const senderSlug = slugify(opts.localUserName);
  const titleBase = senderSlug ? `${senderSlug}_vouchers_${today}` : `vouchers_${today}`;
  const fontFamily = opts.renderOpts?.branding?.fontFamily ?? "'Segoe UI', Arial, sans-serif";

  const cards = vouchers
    .map((v, i) => {
      const card = renderVoucherCard(v, opts.renderOpts);
      if (i === 0) return card;
      return `<div style="page-break-before: always; break-before: page;">${card}</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(titleBase)}</title>
  <style>${PRINT_CSS}${VOUCHER_PRINT_EXTRA}</style>
</head>
<body style="margin:0; padding:32px 16px; background:#f4f6fb; font-family: ${fontFamily};">
  <div class="no-print" style="max-width:920px; margin:0 auto 20px; display:flex; align-items:center; gap:12px;">
    <a href="/vouchers" style="color:#3949ab; text-decoration:none; font-size:14px; font-weight:600;">← Back</a>
    <span style="flex:1;"></span>
    <span style="color:#666; font-size:13px;">Printing ${vouchers.length} voucher${vouchers.length === 1 ? '' : 's'} — print dialog should open automatically.</span>
  </div>
  ${cards}
  <script>setTimeout(function () { window.print(); }, 100);</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
