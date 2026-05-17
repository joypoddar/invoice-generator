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
  const currency = (def.currency as string | undefined) ?? '';
  const rows = items
    .map(
      (it) =>
        `<tr><td>${escapeHtml(it.description)}</td><td>${it.quantity}</td><td>${it.unitPrice.toFixed(2)}</td><td>${(it.quantity * it.unitPrice).toFixed(2)}</td></tr>`,
    )
    .join('');
  const customSection = hasCustomFields(invoice)
    ? `<h3>Additional fields</h3><ul>${Object.entries(invoice.custom)
        .map(([k, v]) => `<li><strong>${escapeHtml(k)}</strong>: ${escapeHtml(String(v))}</li>`)
        .join('')}</ul>`
    : '';
  return `<!DOCTYPE html>
<html><body style="font-family: sans-serif; max-width: 720px;">
  <h2>Invoice ${escapeHtml(String(def.invoiceNumber))}</h2>
  <p><strong>From:</strong> ${escapeHtml(String(def.fromName))} &lt;${escapeHtml(String(def.fromEmail))}&gt;</p>
  <p><strong>To:</strong> ${escapeHtml(String(def.customerName ?? ''))} &lt;${escapeHtml(String(def.customerEmail ?? ''))}&gt;</p>
  <p><strong>Issued:</strong> ${escapeHtml(String(def.issueDate ?? ''))} &nbsp; <strong>Due:</strong> ${escapeHtml(String(def.dueDate ?? ''))}</p>
  <table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;">
    <thead><tr><th align="left">Description</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3" align="right"><strong>Total</strong></td><td><strong>${total.toFixed(2)} ${escapeHtml(currency)}</strong></td></tr></tfoot>
  </table>
  ${customSection}
  ${def.notes ? `<p><em>${escapeHtml(String(def.notes))}</em></p>` : ''}
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
