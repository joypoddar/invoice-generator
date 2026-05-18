import { createTransport, type SendMailOptions } from 'nodemailer';
import {
  INVOICE_HEADER_NAME,
  INVOICE_HEADER_VALUE,
  hasCustomFields,
  renderSubject,
  sidecarFilenameFor,
  subjectFor,
  totalFor,
  type Invoice,
  type LineItem,
} from '@invoice/shared';
import { formatCurrency, formatDate, formatPercent } from './format.js';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  secure?: boolean;
}

export interface Recipients {
  to: string[];
  cc?: string[];
  bcc?: string[];
}

export interface BrandingOpts {
  primaryColor?: string;
  fontFamily?: string;
  logoUrl?: string;
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
   * If set, used as the email subject after placeholder substitution.
   * Placeholders: {invoiceNumber}, {customerName}, {total}, {currency},
   * {issueDate}, {dueDate}. Falls back to subjectFor(invoice) when undefined.
   */
  subjectTemplate?: string;
}

const DEFAULT_PRIMARY_COLOR = '#3949ab';
const DEFAULT_FONT_FAMILY = "'Segoe UI', Arial, sans-serif";

export function buildMailOptions(
  invoice: Invoice,
  recipients: Recipients,
  fromAddress: string,
  opts: RenderOpts = {},
): SendMailOptions {
  const filename = sidecarFilenameFor(String(invoice.default.invoiceNumber));
  const subject = opts.subjectTemplate
    ? renderSubject(opts.subjectTemplate, invoice)
    : subjectFor(invoice);
  const result: SendMailOptions = {
    from: fromAddress,
    to: recipients.to.join(', '),
    subject,
    html: renderInvoiceHtml(invoice, opts),
    attachments: [
      {
        filename,
        content: JSON.stringify(invoice, null, 2),
        contentType: 'application/json',
      },
    ],
    headers: {
      [INVOICE_HEADER_NAME]: INVOICE_HEADER_VALUE,
    },
  };
  if (recipients.cc && recipients.cc.length > 0) result.cc = recipients.cc.join(', ');
  if (recipients.bcc && recipients.bcc.length > 0) result.bcc = recipients.bcc.join(', ');
  return result;
}

export async function sendInvoice(
  invoice: Invoice,
  recipients: Recipients,
  smtp: SmtpConfig,
  password: string,
  opts: RenderOpts = {},
): Promise<void> {
  const transporter = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? smtp.port === 465,
    auth: { user: smtp.user, pass: password },
  });
  const mail = buildMailOptions(invoice, recipients, smtp.user, opts);
  await transporter.sendMail(mail);
}

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

export function renderInvoiceHtml(invoice: Invoice, opts: RenderOpts = {}): string {
  const def = invoice.default;
  const items = (def.lineItems as LineItem[] | undefined) ?? [];
  const subtotal = totalFor(invoice);
  const currency = (def.currency as string | undefined) ?? 'INR';

  const primary = opts.branding?.primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const fontFamily = opts.branding?.fontFamily ?? DEFAULT_FONT_FAMILY;
  const dateFormat = opts.dateFormat;

  const issueDate = formatDate(def.issueDate as string | undefined, dateFormat);
  const dueDate = formatDate(def.dueDate as string | undefined, dateFormat);

  // Tax + total. taxAmount is computed at `invoice new` time but recompute
  // defensively here in case it's missing from older invoices.
  const taxRate = typeof def.taxRate === 'number' ? (def.taxRate as number) : undefined;
  const taxLabel = (def.taxLabel as string | undefined) ?? 'Tax';
  const taxAmount =
    typeof def.taxAmount === 'number'
      ? (def.taxAmount as number)
      : taxRate !== undefined
        ? subtotal * taxRate
        : undefined;
  const total = subtotal + (taxAmount ?? 0);

  // Sender / recipient / bank fields (default first, custom legacy second)
  const fromName = pickField(invoice, 'fromName');
  const fromEmail = pickField(invoice, 'fromEmail');
  const companyPhone = pickField(invoice, 'companyPhone', 'fromPhone');
  const customerName = pickField(invoice, 'customerName');
  const customerEmail = pickField(invoice, 'customerEmail');
  const customerAddress = pickField(invoice, 'customerAddress');
  const bankAccountName = pickField(invoice, 'bankAccountName');
  const bankAccountNumber = pickField(invoice, 'bankAccountNumber');
  const bankIfsc = pickField(invoice, 'bankIfsc');
  const bankAccountType = pickField(invoice, 'bankAccountType');
  const bankName = pickField(invoice, 'bankName');
  const paymentInstructions = pickField(invoice, 'paymentInstructions');

  const showBankDetails =
    bankAccountName || bankAccountNumber || bankIfsc || bankAccountType || bankName;

  // Line-item rows
  const rows = items
    .map(
      (it, i) => `
      <tr style="background:#fff;">
        <td style="padding:10px 14px; color:#444; font-size:13px;">${i + 1}.</td>
        <td style="padding:10px 14px; color:#444; font-size:13px;">${escapeHtml(it.description)}</td>
        <td style="padding:10px 14px; color:#444; font-size:13px; text-align:right;">
          ${escapeHtml(formatCurrency(it.quantity * it.unitPrice, currency))}
        </td>
      </tr>`,
    )
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
    taxRate,
    taxLabel,
    taxAmount,
    total,
    currency,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Invoice ${escapeHtml(String(def.invoiceNumber))}</title>
  <style>
    /* Print rules. Inline styles above keep the email rendering intact in
       clients that strip <style>; these only kick in for window.print(). */
    @page { size: A4; margin: 1.5cm; }
    @media print {
      html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
      body { padding: 0 !important; }
      .invoice-card { box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; max-width: 100% !important; margin: 0 !important; }
      table, tr, td, th { page-break-inside: avoid; }
      h1, h2, h3 { page-break-after: avoid; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body style="margin:0; padding:32px 16px; background:#f4f6fb; font-family: ${fontFamily};">

  <div class="invoice-card" style="max-width:680px; margin:0 auto; background:#fff; border-radius:10px;
              padding:40px 40px 36px; box-shadow:0 2px 16px rgba(57,73,171,0.08);">

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
          <p style="margin:0 0 12px; font-size:14px; font-weight:700; color:#222;">
            ${escapeHtml(fromName)}
          </p>
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
          <p style="margin:0 0 6px; font-size:14px; font-weight:700; color:#222;">
            ${escapeHtml(customerName)}
          </p>
          ${
            customerEmail
              ? `<p style="margin:0 0 4px; font-size:13px; color:#444;">
            ${escapeHtml(customerEmail)}
          </p>`
              : ''
          }
          ${
            customerAddress
              ? `<p style="margin:0; font-size:13px; color:#444; line-height:1.6;">
            ${escapeHtml(customerAddress).replace(/\n/g, '<br/>')}
          </p>`
              : ''
          }
        </td>
      </tr>
    </table>

    <!-- ── Earnings Table ── -->
    <table style="border-collapse:collapse; width:100%; margin-bottom:24px;">
      <thead>
        <tr style="background:${primary};">
          <th style="padding:11px 14px; text-align:left; font-size:13px;
                     font-weight:600; color:#fff; width:40px;"></th>
          <th style="padding:11px 14px; text-align:left; font-size:13px;
                     font-weight:600; color:#fff;">Earning</th>
          <th style="padding:11px 14px; text-align:right; font-size:13px;
                     font-weight:600; color:#fff;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="3" style="padding:12px 14px; color:#aaa; font-size:13px;">No items</td></tr>`}
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

    ${paymentInstructionsSection}
    ${extraCustomSection}
    ${notesSection}

  </div>
</body>
</html>`;
}

function renderBankRow(label: string, value: string): string {
  if (!value) return '';
  const labelParts = label.includes(' ') ? label.split(' ').join('<br/>') : label;
  return `<tr>
    <td style="font-weight:600; padding-right:16px; white-space:nowrap;">${labelParts}</td>
    <td>${escapeHtml(value)}</td>
  </tr>`;
}

function renderTotalBlock(args: {
  subtotal: number;
  taxRate: number | undefined;
  taxLabel: string;
  taxAmount: number | undefined;
  total: number;
  currency: string;
}): string {
  const { subtotal, taxRate, taxLabel, taxAmount, total, currency } = args;
  const showTax = typeof taxAmount === 'number';
  const subtotalRow = showTax
    ? `<tr>
        <td style="padding:6px 0; font-size:13px; color:#555;">Subtotal</td>
        <td style="padding:6px 0; font-size:13px; color:#555; text-align:right;">${escapeHtml(formatCurrency(subtotal, currency))}</td>
      </tr>`
    : '';
  const taxRow =
    showTax && taxRate !== undefined
      ? `<tr>
        <td style="padding:6px 0; font-size:13px; color:#555;">${escapeHtml(taxLabel)} (${escapeHtml(formatPercent(taxRate))})</td>
        <td style="padding:6px 0; font-size:13px; color:#555; text-align:right;">${escapeHtml(formatCurrency(taxAmount, currency))}</td>
      </tr>`
      : showTax
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
