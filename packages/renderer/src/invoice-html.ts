import { hasCustomFields, type Invoice, type LineItem } from '@invoice/shared';
import { formatCurrency, formatCurrencyMaybeInt, formatDate } from './format.js';
import { resolveImageSrc } from './image-embed.js';
import { slugify } from './slugify.js';

export interface BrandingOpts {
  primaryColor?: string;
  fontFamily?: string;
  logoUrl?: string;
  /** Local path or http(s) URL to a signature image. Omits block when unset. */
  signatureUrl?: string;
  /** Caption below the signature image. Default "Authorised Signatory". */
  signatoryLabel?: string;
}

/**
 * Visual + formatting knobs threaded through `renderInvoiceHtml`. Pulled from
 * `config.branding.*` and `config.invoice.{dateFormat,currencyFormat}` at the
 * call site (not from the invoice — these are current-config-time concerns,
 * not historical).
 */
export interface RenderOpts {
  branding?: BrandingOpts;
  dateFormat?: string;
  currencyFormat?: string;
  /**
   * Reserved for the caller (e.g. send pipeline) to thread through to subject
   * line building. The renderer itself ignores this; included here for
   * back-compat with the previous co-located `RenderOpts` shape.
   */
  subjectTemplate?: string;
}

const DEFAULT_PRIMARY_COLOR = '#3949ab';
const DEFAULT_FONT_FAMILY = "'Segoe UI', Arial, sans-serif";

/**
 * Shared print stylesheet used by both single-invoice (`renderInvoiceHtml`)
 * and stacked-batch pages. Exported so the dashboard's batch view can paste it
 * into its own <head> verbatim. `@page margin: 0` removes the browser's
 * header/footer margin (URL + timestamp); the 1.5cm is restored as padding on
 * .invoice-card so each card has the same visual breathing room.
 */
export const PRINT_CSS = `
    @page { size: A4; margin: 0; }
    @media print {
      html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
      body { margin: 0 !important; padding: 0 !important; }
      .invoice-card { box-shadow: none !important; border-radius: 0 !important; padding: 1.5cm !important; max-width: 100% !important; margin: 0 !important; }
      table, tr, td, th { page-break-inside: avoid; }
      h1, h2, h3 { page-break-after: avoid; }
      .no-print { display: none !important; }
    }`;

/**
 * Read a field from invoice.default first; fall back to invoice.custom under
 * the legacy key. Lets v1 invoices (which stored bank/phone/address in custom)
 * still render correctly after the Phase-4 schema migration.
 */
function pickField(invoice: Invoice, defaultKey: string, customKey?: string): string {
  const fromDefault = invoice.default[defaultKey];
  if (fromDefault !== undefined && fromDefault !== '') return String(fromDefault);
  const fromCustom = invoice.custom[customKey ?? defaultKey];
  if (fromCustom !== undefined && fromCustom !== '') return String(fromCustom);
  return '';
}

/**
 * Render just the `<div class="invoice-card">…</div>` block — no doctype, html,
 * head, body wrappers. Used by the dashboard's batch route to stack N invoices
 * on one page (each in its own page-break wrapper). Single-invoice / email
 * callers should use `renderInvoiceHtml` instead.
 */
export function renderInvoiceCard(invoice: Invoice, opts: RenderOpts = {}): string {
  const def = invoice.default;
  const items = (def.lineItems as LineItem[] | undefined) ?? [];
  const currency = (def.currency as string | undefined) ?? 'INR';

  const primary = opts.branding?.primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const fontFamily = opts.branding?.fontFamily ?? DEFAULT_FONT_FAMILY;
  const dateFormat = opts.dateFormat;

  const issueDate = formatDate(def.issueDate as string | undefined, dateFormat);
  const dueDate = formatDate(def.dueDate as string | undefined, dateFormat);

  const invoiceTaxRate = typeof def.taxRate === 'number' ? (def.taxRate as number) : undefined;
  const taxLabel = (def.taxLabel as string | undefined) ?? 'Tax';
  const lineItemHeader = (def.lineItemHeader as string | undefined) ?? 'Description';

  // Per-line tax: each line uses its own taxRate if present, else invoice-level
  // taxRate, else 0. Totals are summed from the lines so they always reconcile
  // with what the line column shows.
  const computed = items.map((it) => {
    const rate = typeof it.taxRate === 'number' ? it.taxRate : (invoiceTaxRate ?? 0);
    const amount = it.quantity * it.unitPrice;
    const igst = amount * rate;
    return { item: it, rate, amount, igst, total: amount + igst };
  });
  const subtotal = computed.reduce((s, c) => s + c.amount, 0);
  const totalIgst = computed.reduce((s, c) => s + c.igst, 0);
  const total = subtotal + totalIgst;

  // Sender / recipient / bank fields (default first, custom legacy second)
  const fromName = pickField(invoice, 'fromName');
  const fromEmail = pickField(invoice, 'fromEmail');
  const companyAddress = pickField(invoice, 'companyAddress');
  const companyPhone = pickField(invoice, 'companyPhone', 'fromPhone');
  const customerName = pickField(invoice, 'customerName');
  const customerEmail = pickField(invoice, 'customerEmail');
  const customerAddress = pickField(invoice, 'customerAddress');
  const customerPhone = pickField(invoice, 'customerPhone');
  const bankAccountName = pickField(invoice, 'bankAccountName');
  const bankAccountNumber = pickField(invoice, 'bankAccountNumber');
  // Defensive uppercase: pre-4.10 configs may have lowercase IFSC; the convention
  // is uppercase (e.g., HDFC0001234) and customers expect to see it that way.
  const bankIfscRaw = pickField(invoice, 'bankIfsc');
  const bankIfsc = bankIfscRaw ? bankIfscRaw.toUpperCase() : bankIfscRaw;
  const bankAccountType = pickField(invoice, 'bankAccountType');
  const bankName = pickField(invoice, 'bankName');
  const paymentInstructions = pickField(invoice, 'paymentInstructions');

  const showBankDetails =
    bankAccountName || bankAccountNumber || bankIfsc || bankAccountType || bankName;

  // 6-column line-item rows: # | <header> | Qty | Rate | Amount | IGST | Total
  // (Rate uses fraction-only-if-present formatting to match the typical invoice
  // style; Amount/IGST/Total always show two decimals.)
  const showTaxColumn = computed.some((c) => c.rate > 0) || invoiceTaxRate !== undefined;
  const rows = computed
    .map(({ item: it, amount, igst, total: lineTotal }, i) => {
      const taxCell = showTaxColumn
        ? `<td style="padding:10px 14px; color:#444; font-size:13px; text-align:right;">${escapeHtml(formatCurrency(igst, currency))}</td>`
        : '';
      return `
      <tr style="background:#fff;">
        <td style="padding:10px 14px; color:#444; font-size:13px; width:36px;">${i + 1}.</td>
        <td style="padding:10px 14px; color:#444; font-size:13px;">${escapeHtml(it.description)}</td>
        <td style="padding:10px 14px; color:#444; font-size:13px; text-align:center;">${it.quantity}</td>
        <td style="padding:10px 14px; color:#444; font-size:13px; text-align:right;">${escapeHtml(formatCurrencyMaybeInt(it.unitPrice, currency))}</td>
        <td style="padding:10px 14px; color:#444; font-size:13px; text-align:right;">${escapeHtml(formatCurrency(amount, currency))}</td>
        ${taxCell}
        <td style="padding:10px 14px; color:#444; font-size:13px; text-align:right;">${escapeHtml(formatCurrency(lineTotal, currency))}</td>
      </tr>`;
    })
    .join('');

  // Extra custom fields (excluding bank/phone/address — those have moved to default)
  const handledCustomKeys = new Set([
    'bankAccountName',
    'bankAccountNumber',
    'bankIfsc',
    'bankAccountType',
    'bankName',
    'fromPhone',
    'customerAddress',
  ]);
  const extraCustomEntries = hasCustomFields(invoice)
    ? Object.entries(invoice.custom).filter(([k]) => !handledCustomKeys.has(k))
    : [];

  const extraCustomSection =
    extraCustomEntries.length > 0
      ? `<div style="margin-top:24px;">
        <p style="font-weight:600; color:${primary}; margin:0 0 8px;">Additional Information</p>
        <ul style="margin:0; padding-left:18px; color:#555; font-size:13px; line-height:1.8;">
          ${extraCustomEntries
            .map(([k, v]) => `<li><strong>${escapeHtml(k)}</strong>: ${escapeHtml(String(v))}</li>`)
            .join('')}
        </ul>
      </div>`
      : '';

  const paymentInstructionsSection = paymentInstructions
    ? `<div style="margin-top:16px; background:#f7f7fb; border-left:3px solid ${primary};
                  padding:12px 16px; border-radius:4px;">
        <p style="margin:0 0 6px; font-weight:600; color:${primary}; font-size:13px;">Payment Instructions</p>
        <p style="margin:0; font-size:13px; color:#444; line-height:1.6; white-space:pre-line;">${escapeHtml(paymentInstructions)}</p>
      </div>`
    : '';

  const notesSection = def.notes
    ? `<p style="margin-top:20px; font-size:13px; color:#777; font-style:italic;">
        ${escapeHtml(String(def.notes))}
       </p>`
    : '';

  // Total block: subtotal + (optional) tax + total. Top-row has the accounting
  // double-rule above the running total.
  const totalBlock = renderTotalBlock({
    subtotal,
    taxLabel,
    taxAmount: showTaxColumn ? totalIgst : undefined,
    total,
    currency,
  });

  // Signature block (opt-in via branding.signatureUrl).
  const signatureBlock = renderSignatureBlock(opts.branding, primary);

  return `<div class="invoice-card" style="max-width:680px; margin:0 auto; background:#fff; border-radius:10px;
              padding:40px 40px 36px; box-shadow:0 2px 16px rgba(57,73,171,0.08); font-family: ${fontFamily};">

    <!-- ── Title ── -->
    <h1 style="margin:0 0 24px; font-size:32px; font-weight:700; color:${primary};">Invoice</h1>

    <!-- ── Meta ── -->
    <table style="border-collapse:collapse; margin-bottom:28px; font-size:13px; color:#555;">
      <tr>
        <td style="padding:3px 16px 3px 0; color:#888;">Invoice No #</td>
        <td style="padding:3px 0; font-weight:700; color:#222;">${escapeHtml(String(def.invoiceNumber))}</td>
      </tr>
      <tr>
        <td style="padding:3px 16px 3px 0; color:#888;">Invoice Date</td>
        <td style="padding:3px 0; font-weight:700; color:#222;">${escapeHtml(issueDate)}</td>
      </tr>
      <tr>
        <td style="padding:3px 16px 3px 0; color:#888;">Due Date</td>
        <td style="padding:3px 0; font-weight:700; color:#222;">${escapeHtml(dueDate)}</td>
      </tr>
    </table>

    <!-- ── Billed By / Billed To ── -->
    <table style="border-collapse:collapse; width:100%; margin-bottom:28px;">
      <tr>
        <td style="width:48%; vertical-align:top; background:#eef0fb; border-radius:8px;
                   padding:18px 20px;">
          <p style="margin:0 0 10px; font-size:14px; font-weight:700; color:${primary};">Billed By</p>
          <p style="margin:0 0 ${companyAddress ? '6px' : '12px'}; font-size:14px; font-weight:700; color:#222;">
            ${escapeHtml(fromName)}
          </p>
          ${
            companyAddress
              ? `<p style="margin:0 0 8px; font-size:13px; color:#444; line-height:1.6;">
            ${escapeHtml(companyAddress).replace(/\n/g, '<br/>')}
          </p>`
              : ''
          }
          ${
            fromEmail
              ? `<p style="margin:0 0 4px; font-size:13px; color:#444;">
            <strong>Email:</strong> ${escapeHtml(fromEmail)}
          </p>`
              : ''
          }
          ${
            companyPhone
              ? `<p style="margin:0; font-size:13px; color:#444;">
            <strong>Phone:</strong> ${escapeHtml(companyPhone)}
          </p>`
              : ''
          }
        </td>

        <td style="width:4%;"></td>

        <td style="width:48%; vertical-align:top; background:#eef0fb; border-radius:8px;
                   padding:18px 20px;">
          <p style="margin:0 0 10px; font-size:14px; font-weight:700; color:${primary};">Billed To</p>
          <p style="margin:0 0 ${customerAddress ? '6px' : '12px'}; font-size:14px; font-weight:700; color:#222;">
            ${escapeHtml(customerName)}
          </p>
          ${
            customerAddress
              ? `<p style="margin:0 0 8px; font-size:13px; color:#444; line-height:1.6;">
            ${escapeHtml(customerAddress).replace(/\n/g, '<br/>')}
          </p>`
              : ''
          }
          ${
            customerEmail
              ? `<p style="margin:0 0 4px; font-size:13px; color:#444;">
            <strong>Email:</strong> ${escapeHtml(customerEmail)}
          </p>`
              : ''
          }
          ${
            customerPhone
              ? `<p style="margin:0; font-size:13px; color:#444;">
            <strong>Phone:</strong> ${escapeHtml(customerPhone)}
          </p>`
              : ''
          }
        </td>
      </tr>
    </table>

    <!-- ── Line items table ── -->
    <table style="border-collapse:collapse; width:100%; margin-bottom:24px;">
      <thead>
        <tr style="background:${primary};">
          <th style="padding:11px 14px; text-align:left; font-size:13px;
                     font-weight:600; color:#fff; width:36px;"></th>
          <th style="padding:11px 14px; text-align:left; font-size:13px;
                     font-weight:600; color:#fff;">${escapeHtml(lineItemHeader)}</th>
          <th style="padding:11px 14px; text-align:center; font-size:13px;
                     font-weight:600; color:#fff;">Quantity</th>
          <th style="padding:11px 14px; text-align:right; font-size:13px;
                     font-weight:600; color:#fff;">Rate</th>
          <th style="padding:11px 14px; text-align:right; font-size:13px;
                     font-weight:600; color:#fff;">Amount</th>
          ${
            showTaxColumn
              ? `<th style="padding:11px 14px; text-align:right; font-size:13px;
                     font-weight:600; color:#fff;">${escapeHtml(taxLabel)}</th>`
              : ''
          }
          <th style="padding:11px 14px; text-align:right; font-size:13px;
                     font-weight:600; color:#fff;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="${showTaxColumn ? 7 : 6}" style="padding:12px 14px; color:#aaa; font-size:13px;">No items</td></tr>`}
      </tbody>
    </table>

    <!-- ── Footer row: bank box + totals ── -->
    <table style="border-collapse:collapse; width:100%; margin-bottom:24px;">
      <tr style="vertical-align:top;">
        ${
          showBankDetails
            ? `<td style="width:48%;">
          <div style="background:#eef0fb; border-radius:8px; padding:18px 20px;">
            <p style="margin:0 0 12px; font-size:14px; font-weight:700; color:${primary};">Bank Details</p>
            <table style="border-collapse:collapse; font-size:13px; color:#444; line-height:2;">
              ${renderBankRow('Account Name', bankAccountName)}
              ${renderBankRow('Account Number', bankAccountNumber)}
              ${renderBankRow('IFSC', bankIfsc)}
              ${renderBankRow('Account Type', bankAccountType)}
              ${renderBankRow('Bank', bankName)}
            </table>
          </div>
        </td>`
            : '<td style="width:48%;"></td>'
        }

        <td style="width:4%;"></td>

        <td style="width:48%; vertical-align:bottom;">${totalBlock}</td>
      </tr>
    </table>

    ${signatureBlock}
    ${paymentInstructionsSection}
    ${extraCustomSection}
    ${notesSection}

  </div>`;
}

/**
 * Full-document HTML for one invoice (doctype + html + head + body + card).
 * Used by `sendInvoice` (email body) and the dashboard's invoice-detail page.
 * The document <title> drives the browser's PDF-filename suggestion.
 */
export function renderInvoiceHtml(invoice: Invoice, opts: RenderOpts = {}): string {
  const def = invoice.default;
  const fromName = pickField(invoice, 'fromName');
  const fontFamily = opts.branding?.fontFamily ?? DEFAULT_FONT_FAMILY;
  const card = renderInvoiceCard(invoice, opts);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(buildTitle(fromName, String(def.invoiceNumber)))}</title>
  <style>${PRINT_CSS}</style>
</head>
<body style="margin:0; padding:32px 16px; background:#f4f6fb; font-family: ${fontFamily};">
${card}
</body>
</html>`;
}

function renderSignatureBlock(branding: BrandingOpts | undefined, primary: string): string {
  const url = branding?.signatureUrl;
  if (!url) return '';
  const src = resolveImageSrc(url);
  if (!src) return '';
  const label = branding?.signatoryLabel ?? 'Authorised Signatory';
  return `<div style="margin-top:8px; text-align:right;">
    <img src="${src}" alt="Signature" style="max-height:60px; max-width:240px;" />
    <p style="margin:4px 0 0; font-size:12px; color:${primary};">${escapeHtml(label)}</p>
  </div>`;
}

function renderBankRow(label: string, value: string): string {
  if (!value) return '';
  return `<tr>
    <td style="font-weight:600; padding-right:16px; white-space:nowrap;">${label}</td>
    <td>${escapeHtml(value)}</td>
  </tr>`;
}

function renderTotalBlock(args: {
  subtotal: number;
  taxLabel: string;
  taxAmount: number | undefined;
  total: number;
  currency: string;
}): string {
  const { subtotal, taxLabel, taxAmount, total, currency } = args;
  const showTax = typeof taxAmount === 'number';
  const subtotalRow = showTax
    ? `<tr>
        <td style="padding:6px 0; font-size:13px; color:#555;">Amount</td>
        <td style="padding:6px 0; font-size:13px; color:#555; text-align:right;">${escapeHtml(formatCurrency(subtotal, currency))}</td>
      </tr>`
    : '';
  const taxRow = showTax
    ? `<tr>
        <td style="padding:6px 0; font-size:13px; color:#555;">${escapeHtml(taxLabel)}</td>
        <td style="padding:6px 0; font-size:13px; color:#555; text-align:right;">${escapeHtml(formatCurrency(taxAmount, currency))}</td>
      </tr>`
    : '';

  return `<table style="border-collapse:collapse; width:100%;">
    ${subtotalRow}
    ${taxRow}
    <tr>
      <td style="border-top:2px solid #ddd; padding:14px 0 4px;
                 font-size:15px; font-weight:600; color:#333;">
        Total (${escapeHtml(currency)})
      </td>
      <td style="border-top:2px solid #ddd; padding:14px 0 4px;
                 font-size:15px; font-weight:700; color:#222; text-align:right;">
        ${escapeHtml(formatCurrency(total, currency))}
      </td>
    </tr>
  </table>`;
}

/**
 * Document title drives the browser's PDF-filename suggestion in Save-as-PDF.
 * `john_doe_invoice_cre-2026-0001` becomes `john_doe_invoice_cre-2026-0001.pdf`.
 * Empty sender falls back to `invoice_<number>`.
 */
function buildTitle(fromName: string, invoiceNumber: string): string {
  const senderSlug = slugify(fromName);
  const numberSlug = slugify(invoiceNumber);
  return senderSlug
    ? `${senderSlug}_invoice_${numberSlug}`
    : `invoice_${numberSlug}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
