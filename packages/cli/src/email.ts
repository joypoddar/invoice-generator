import { createTransport, type SendMailOptions } from 'nodemailer';
import {
  INVOICE_HEADER_NAME,
  INVOICE_HEADER_VALUE,
  hasCustomFields,
  sidecarFilenameFor,
  subjectFor,
  totalFor,
  type Invoice,
  type LineItem,
} from '@invoice/shared';

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

export function buildMailOptions(
  invoice: Invoice,
  recipients: Recipients,
  fromAddress: string,
): SendMailOptions {
  const filename = sidecarFilenameFor(String(invoice.default.invoiceNumber));
  const opts: SendMailOptions = {
    from: fromAddress,
    to: recipients.to.join(', '),
    subject: subjectFor(invoice),
    html: renderInvoiceHtml(invoice),
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
  if (recipients.cc && recipients.cc.length > 0) opts.cc = recipients.cc.join(', ');
  if (recipients.bcc && recipients.bcc.length > 0) opts.bcc = recipients.bcc.join(', ');
  return opts;
}

export async function sendInvoice(
  invoice: Invoice,
  recipients: Recipients,
  smtp: SmtpConfig,
  password: string,
): Promise<void> {
  const transporter = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure ?? smtp.port === 465,
    auth: { user: smtp.user, pass: password },
  });
  const opts = buildMailOptions(invoice, recipients, smtp.user);
  await transporter.sendMail(opts);
}

export function renderInvoiceHtml(invoice: Invoice): string {
  const def = invoice.default;
  const items = (def.lineItems as LineItem[] | undefined) ?? [];
  const total = totalFor(invoice);
  const currency = (def.currency as string | undefined) ?? 'INR';

  // Bank details (pulled from custom fields if present)
  const custom = invoice.custom ?? {};
  const bankAccountName = escapeHtml(String(custom.bankAccountName ?? def.fromName ?? ''));
  const bankAccountNumber = escapeHtml(String(custom.bankAccountNumber ?? ''));
  const bankIfsc = escapeHtml(String(custom.bankIfsc ?? ''));
  const bankAccountType = escapeHtml(String(custom.bankAccountType ?? ''));
  const bankName = escapeHtml(String(custom.bankName ?? ''));

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
          ${currency === 'INR' ? '₹' : currency}${(it.quantity * it.unitPrice).toFixed(2)}
        </td>
      </tr>`,
    )
    .join('');

  // Extra custom fields (excluding bank-related ones we already used)
  const bankKeys = new Set([
    'bankAccountName',
    'bankAccountNumber',
    'bankIfsc',
    'bankAccountType',
    'bankName',
  ]);
  const extraCustomEntries = hasCustomFields(invoice)
    ? Object.entries(invoice.custom).filter(([k]) => !bankKeys.has(k))
    : [];

  const extraCustomSection =
    extraCustomEntries.length > 0
      ? `<div style="margin-top:24px;">
        <p style="font-weight:600; color:#3949ab; margin:0 0 8px;">Additional Information</p>
        <ul style="margin:0; padding-left:18px; color:#555; font-size:13px; line-height:1.8;">
          ${extraCustomEntries
            .map(([k, v]) => `<li><strong>${escapeHtml(k)}</strong>: ${escapeHtml(String(v))}</li>`)
            .join('')}
        </ul>
      </div>`
      : '';

  const notesSection = def.notes
    ? `<p style="margin-top:20px; font-size:13px; color:#777; font-style:italic;">
        ${escapeHtml(String(def.notes))}
       </p>`
    : '';

  const currencySymbol = currency === 'INR' ? '₹' : currency;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Invoice ${escapeHtml(String(def.invoiceNumber))}</title>
</head>
<body style="margin:0; padding:32px 16px; background:#f4f6fb; font-family: 'Segoe UI', Arial, sans-serif;">

  <div style="max-width:680px; margin:0 auto; background:#fff; border-radius:10px;
              padding:40px 40px 36px; box-shadow:0 2px 16px rgba(57,73,171,0.08);">

    <!-- ── Title ── -->
    <h1 style="margin:0 0 24px; font-size:32px; font-weight:700; color:#3949ab;">Invoice</h1>

    <!-- ── Meta ── -->
    <table style="border-collapse:collapse; margin-bottom:28px; font-size:13px; color:#555;">
      <tr>
        <td style="padding:3px 16px 3px 0; color:#888;">Invoice No #</td>
        <td style="padding:3px 0; font-weight:700; color:#222;">${escapeHtml(String(def.invoiceNumber))}</td>
      </tr>
      <tr>
        <td style="padding:3px 16px 3px 0; color:#888;">Invoice Date</td>
        <td style="padding:3px 0; font-weight:700; color:#222;">${escapeHtml(String(def.issueDate ?? ''))}</td>
      </tr>
      <tr>
        <td style="padding:3px 16px 3px 0; color:#888;">Due Date</td>
        <td style="padding:3px 0; font-weight:700; color:#222;">${escapeHtml(String(def.dueDate ?? ''))}</td>
      </tr>
    </table>

    <!-- ── Billed By / Billed To ── -->
    <table style="border-collapse:collapse; width:100%; margin-bottom:28px;">
      <tr>
        <!-- Billed By -->
        <td style="width:48%; vertical-align:top; background:#eef0fb; border-radius:8px;
                   padding:18px 20px;">
          <p style="margin:0 0 10px; font-size:14px; font-weight:700; color:#3949ab;">Billed By</p>
          <p style="margin:0 0 12px; font-size:14px; font-weight:700; color:#222;">
            ${escapeHtml(String(def.fromName ?? ''))}
          </p>
          ${
            def.fromEmail
              ? `<p style="margin:0 0 4px; font-size:13px; color:#444;">
            <strong>Email:</strong> ${escapeHtml(String(def.fromEmail))}
          </p>`
              : ''
          }
          ${
            custom.fromPhone
              ? `<p style="margin:0; font-size:13px; color:#444;">
            <strong>Phone:</strong> ${escapeHtml(String(custom.fromPhone))}
          </p>`
              : ''
          }
        </td>

        <td style="width:4%;"></td>

        <!-- Billed To -->
        <td style="width:48%; vertical-align:top; background:#eef0fb; border-radius:8px;
                   padding:18px 20px;">
          <p style="margin:0 0 10px; font-size:14px; font-weight:700; color:#3949ab;">Billed To</p>
          <p style="margin:0 0 6px; font-size:14px; font-weight:700; color:#222;">
            ${escapeHtml(String(def.customerName ?? ''))}
          </p>
          ${
            def.customerEmail
              ? `<p style="margin:0 0 4px; font-size:13px; color:#444;">
            ${escapeHtml(String(def.customerEmail))}
          </p>`
              : ''
          }
          ${
            custom.customerAddress
              ? `<p style="margin:0; font-size:13px; color:#444; line-height:1.6;">
            ${escapeHtml(String(custom.customerAddress)).replace(/\n/g, '<br/>')}
          </p>`
              : ''
          }
        </td>
      </tr>
    </table>

    <!-- ── Earnings Table ── -->
    <table style="border-collapse:collapse; width:100%; margin-bottom:24px;">
      <thead>
        <tr style="background:#3949ab;">
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

    <!-- ── Bank Details + Total ── -->
    <table style="border-collapse:collapse; width:100%; margin-bottom:24px;">
      <tr style="vertical-align:top;">

        <!-- Bank Details -->
        ${
          showBankDetails
            ? `
        <td style="width:48%;">
          <div style="background:#eef0fb; border-radius:8px; padding:18px 20px;">
            <p style="margin:0 0 12px; font-size:14px; font-weight:700; color:#3949ab;">Bank Details</p>
            <table style="border-collapse:collapse; font-size:13px; color:#444; line-height:2;">
              ${
                bankAccountName
                  ? `<tr>
                <td style="font-weight:600; padding-right:16px; white-space:nowrap;">Account<br/>Name</td>
                <td>${bankAccountName}</td>
              </tr>`
                  : ''
              }
              ${
                bankAccountNumber
                  ? `<tr>
                <td style="font-weight:600; padding-right:16px; white-space:nowrap;">Account<br/>Number</td>
                <td>${bankAccountNumber}</td>
              </tr>`
                  : ''
              }
              ${
                bankIfsc
                  ? `<tr>
                <td style="font-weight:600; padding-right:16px;">IFSC</td>
                <td>${bankIfsc}</td>
              </tr>`
                  : ''
              }
              ${
                bankAccountType
                  ? `<tr>
                <td style="font-weight:600; padding-right:16px; white-space:nowrap;">Account<br/>Type</td>
                <td>${bankAccountType}</td>
              </tr>`
                  : ''
              }
              ${
                bankName
                  ? `<tr>
                <td style="font-weight:600; padding-right:16px;">Bank</td>
                <td>${bankName}</td>
              </tr>`
                  : ''
              }
            </table>
          </div>
        </td>`
            : '<td style="width:48%;"></td>'
        }

        <td style="width:4%;"></td>

        <!-- Total -->
        <td style="width:48%; vertical-align:bottom; text-align:right; padding-bottom:4px;">
          <table style="border-collapse:collapse; width:100%;">
            <tr>
              <td style="border-top:2px solid #ddd; padding:14px 0 4px;
                         font-size:15px; font-weight:600; color:#333;">
                Total (${escapeHtml(currency)})
              </td>
              <td style="border-top:2px solid #ddd; padding:14px 0 4px;
                         font-size:15px; font-weight:700; color:#222; text-align:right;">
                ${currencySymbol}${total.toFixed(2)}
              </td>
            </tr>
          </table>
        </td>

      </tr>
    </table>

    ${extraCustomSection}
    ${notesSection}

  </div>
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
