import { voucherTotal, type Voucher } from '@invoice/shared';
import { amountToWords } from './amount-to-words.js';
import { formatCurrency, formatDate } from './format.js';
import { resolveImageSrc } from './image-embed.js';
import { PRINT_CSS, type RenderOpts } from './invoice-html.js';
import { slugify } from './slugify.js';

const BANNER_BG = '#0a0e27';
const DEFAULT_FONT_FAMILY = "'Segoe UI', Arial, sans-serif";
/** Minimum body rows so a short voucher keeps the classic ruled-ledger look. */
const MIN_ROWS = 5;
const CELL = 'border:1px solid #333; padding:9px 12px; font-size:13px;';

/** Extra print rules so the voucher card fills the page (PRINT_CSS only targets .invoice-card). */
const VOUCHER_PRINT_EXTRA = `
    @media print {
      .voucher-card { box-shadow:none !important; border:none !important; border-radius:0 !important; margin:0 !important; max-width:100% !important; }
    }`;

/**
 * Render just the `<div class="voucher-card">…</div>` block — no document
 * chrome. Mirrors `renderInvoiceCard`. The logo (branding.logoUrl) is embedded
 * as base64 via `resolveImageSrc`; an unset/unreadable path omits it silently.
 */
export function renderVoucherCard(voucher: Voucher, opts: RenderOpts = {}): string {
  const fontFamily = opts.branding?.fontFamily ?? DEFAULT_FONT_FAMILY;
  const date = formatDate(voucher.date, opts.dateFormat);
  const total = voucherTotal(voucher);
  const currency = voucher.currency || 'INR';

  const logoSrc = opts.branding?.logoUrl ? resolveImageSrc(opts.branding.logoUrl) : null;
  const logoBlock = logoSrc
    ? `<img src="${logoSrc}" alt="Logo" style="max-height:56px; max-width:180px; display:block;" />`
    : '';

  const companyBlock = `${
    voucher.companyName
      ? `<div style="font-weight:700; font-size:17px; margin-bottom:4px;">${escapeHtml(voucher.companyName)}</div>`
      : ''
  }${
    voucher.companyAddress
      ? `<div style="font-size:12px; line-height:1.55; opacity:0.92;">${escapeHtml(voucher.companyAddress).replace(/\n/g, '<br/>')}</div>`
      : ''
  }`;

  const dataRows = voucher.lines
    .map(
      (l, i) => `
        <tr>
          <td style="${CELL} text-align:center; width:120px;">${i + 1}</td>
          <td style="${CELL} width:160px;">${escapeHtml(l.paymentMethod)}</td>
          <td style="${CELL}">${escapeHtml(l.description)}</td>
          <td style="${CELL} text-align:right; width:160px;">${escapeHtml(formatCurrency(l.amount, currency))}</td>
        </tr>`,
    )
    .join('');

  const fillerCount = Math.max(0, MIN_ROWS - voucher.lines.length);
  const fillerRows = Array.from(
    { length: fillerCount },
    () => `
        <tr>
          <td style="${CELL} text-align:center;">&nbsp;</td>
          <td style="${CELL}">&nbsp;</td>
          <td style="${CELL}">&nbsp;</td>
          <td style="${CELL}">&nbsp;</td>
        </tr>`,
  ).join('');

  return `<div class="voucher-card" style="max-width:920px; margin:0 auto; background:#fff;
              border:1px solid #c9cfdd; border-radius:6px; overflow:hidden;
              font-family:${fontFamily}; color:#1a1a1a;">

    <!-- ── Header banner ── -->
    <div style="background:${BANNER_BG}; color:#fff; padding:22px 28px;
                display:flex; align-items:center; justify-content:space-between; gap:24px;">
      <div>${logoBlock}</div>
      <div style="text-align:right;">${companyBlock}</div>
    </div>

    <!-- ── Body ── -->
    <div style="padding:28px 32px 36px;">
      <h1 style="text-align:center; font-size:26px; font-weight:700; margin:6px 0 30px;">
        ${escapeHtml(voucher.title)}
      </h1>

      <!-- ── Payment To / Date / PV No. ── -->
      <table style="width:100%; border-collapse:collapse; margin-bottom:26px; font-size:14px;">
        <tr>
          <td style="width:48%; padding-right:16px;">
            <span style="font-weight:700;">Payment To:&nbsp;</span>
            <span style="border-bottom:1px solid #333; display:inline-block; min-width:200px; padding:0 6px;">${escapeHtml(voucher.payTo)}</span>
          </td>
          <td style="width:26%; text-align:center;">
            <span style="font-weight:700;">Date:</span>
            <span style="border-bottom:1px solid #333; padding:0 6px;">${escapeHtml(date)}</span>
          </td>
          <td style="width:26%; text-align:right;">
            <span style="font-weight:700;">PV. No.:</span>
            <span style="border-bottom:1px solid #333; padding:0 6px;">${escapeHtml(voucher.voucherNumber)}</span>
          </td>
        </tr>
      </table>

      <!-- ── Line items ── -->
      <table style="width:100%; border-collapse:collapse; margin-bottom:24px;">
        <thead>
          <tr>
            <th style="${CELL} text-align:left; font-weight:700;">Serial Number</th>
            <th style="${CELL} text-align:left; font-weight:700;">Payment Method</th>
            <th style="${CELL} text-align:left; font-weight:700;">Description</th>
            <th style="${CELL} text-align:left; font-weight:700;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${dataRows}
          ${fillerRows}
          <tr>
            <td colspan="3" style="${CELL} text-align:right; font-weight:700;">Total</td>
            <td style="${CELL} text-align:right; font-weight:700;">${escapeHtml(formatCurrency(total, currency))}</td>
          </tr>
        </tbody>
      </table>

      <!-- ── Amount in words ── -->
      <p style="margin:0 0 8px; font-size:14px;">
        <span style="font-weight:700;">Amount in Words:</span> ${escapeHtml(amountToWords(total, currency))}
      </p>
      ${
        voucher.notes
          ? `<p style="margin:14px 0 0; font-size:13px; color:#555; font-style:italic;">${escapeHtml(voucher.notes).replace(/\n/g, '<br/>')}</p>`
          : ''
      }

      <!-- ── Signature rule ── -->
      <div style="margin:52px auto 0; width:55%; border-bottom:1px solid #333;"></div>

      <!-- ── Prepared / Received ── -->
      <table style="width:100%; border-collapse:collapse; margin-top:40px; font-size:14px;">
        <tr>
          <td style="width:50%;">
            <span style="display:inline-block; border-bottom:1px solid #333; padding:0 10px 4px; font-weight:700;">
              Prepared By: ${escapeHtml(voucher.preparedBy)}
            </span>
          </td>
          <td style="width:50%; text-align:right;">
            <span style="display:inline-block; border-bottom:1px solid #333; padding:0 10px 4px; font-weight:700;">
              Received By: ${escapeHtml(voucher.receivedBy)}
            </span>
          </td>
        </tr>
      </table>
    </div>
  </div>`;
}

/**
 * Full-document HTML for one voucher (doctype + head + body + card). The
 * document <title> drives the browser's Save-as-PDF filename suggestion.
 */
export function renderVoucherHtml(voucher: Voucher, opts: RenderOpts = {}): string {
  const fontFamily = opts.branding?.fontFamily ?? DEFAULT_FONT_FAMILY;
  const card = renderVoucherCard(voucher, opts);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(buildTitle(voucher.payTo, voucher.voucherNumber))}</title>
  <style>${PRINT_CSS}${VOUCHER_PRINT_EXTRA}</style>
</head>
<body style="margin:0; padding:32px 16px; background:#f4f6fb; font-family:${fontFamily};">
${card}
</body>
</html>`;
}

function buildTitle(payTo: string, voucherNumber: string): string {
  const payToSlug = slugify(payTo);
  const numberSlug = slugify(voucherNumber);
  return payToSlug ? `${payToSlug}_voucher_${numberSlug}` : `voucher_${numberSlug}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
