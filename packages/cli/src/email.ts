import { createTransport, type SendMailOptions } from 'nodemailer';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import {
  INVOICE_HEADER_NAME,
  INVOICE_HEADER_VALUE,
  VOUCHER_HEADER_NAME,
  VOUCHER_HEADER_VALUE,
  renderSubject,
  sidecarFilenameFor,
  sidecarFilenameForVoucher,
  subjectFor,
  type Invoice,
  type Voucher,
} from '@invoice/shared';
import {
  renderInvoiceHtml,
  renderVoucherHtml,
  type BrandingOpts,
  type RenderOpts,
} from '@invoice/renderer';

export type { BrandingOpts, RenderOpts };
export { renderInvoiceHtml };

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

  // Attach logo as CID when possible so email clients render it reliably.
  try {
    const { html: newHtml, attachments: logoAttachments } = tryAttachLogo(
      result.html as string,
      opts.branding,
    );
    if (logoAttachments.length > 0) {
      result.attachments = [...(result.attachments ?? []), ...logoAttachments];
      result.html = newHtml;
    }
  } catch {
    // best-effort; fall back to original HTML if anything goes wrong
  }

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

function renderVoucherSubject(template: string, voucher: Voucher): string {
  return template
    .replaceAll('{voucherNumber}', voucher.voucherNumber)
    .replaceAll('{payTo}', voucher.payTo)
    .replaceAll('{date}', voucher.date)
    .replaceAll('{currency}', voucher.currency)
    .replaceAll('{title}', voucher.title);
}

export function buildVoucherMailOptions(
  voucher: Voucher,
  recipients: Recipients,
  fromAddress: string,
  opts: RenderOpts = {},
): SendMailOptions {
  const filename = sidecarFilenameForVoucher(voucher.voucherNumber);
  const subject = opts.subjectTemplate
    ? renderVoucherSubject(opts.subjectTemplate, voucher)
    : `Payment Voucher ${voucher.voucherNumber} for ${voucher.payTo}`;

  const result: SendMailOptions = {
    from: fromAddress,
    to: recipients.to.join(', '),
    subject,
    html: renderVoucherHtml(voucher, opts),
    attachments: [
      {
        filename,
        content: JSON.stringify(voucher, null, 2),
        contentType: 'application/json',
      },
    ],
    headers: {
      [VOUCHER_HEADER_NAME]: VOUCHER_HEADER_VALUE,
    },
  };
  if (recipients.cc && recipients.cc.length > 0) result.cc = recipients.cc.join(', ');
  if (recipients.bcc && recipients.bcc.length > 0) result.bcc = recipients.bcc.join(', ');
  // Attach logo as CID when possible for vouchers as well
  try {
    const { html: newHtml, attachments: logoAttachments } = tryAttachLogo(
      result.html as string,
      opts.branding,
    );
    if (logoAttachments.length > 0) {
      result.attachments = [...(result.attachments ?? []), ...logoAttachments];
      result.html = newHtml;
    }
  } catch {
    // noop
  }

  return result;
}

export async function sendVoucher(
  voucher: Voucher,
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
  const mail = buildVoucherMailOptions(voucher, recipients, smtp.user, opts);
  await transporter.sendMail(mail);
}

type MailAttachment = {
  filename?: string;
  path?: string;
  content?: Buffer;
  contentType?: string;
  cid?: string;
};

function tryAttachLogo(
  html: string,
  branding?: BrandingOpts,
): { html: string; attachments: MailAttachment[] } {
  if (!html || !branding?.logoUrl) return { html, attachments: [] };
  const logo = branding.logoUrl;
  // If the renderer already embedded a data: URL, find it in the HTML and
  // convert it to a CID attachment so mail clients render it reliably.
  const dataMatch = html.match(/src="(data:[^"]+)"/);
  const cid = 'logo@invoice';
  if (dataMatch && dataMatch[1]) {
    const dataUrl = dataMatch[1];
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
    if (!match || !match[1] || !match[2]) return { html, attachments: [] };
    const mime = match[1];
    const dataBase64 = match[2];
    const data = Buffer.from(dataBase64, 'base64');
    const ext = (mime.split('/')[1] || 'png').replace('+xml', 'svg');
    const filename = `logo.${ext}`;
    const attachment: MailAttachment = { filename, content: data, contentType: mime, cid };
    const newHtml = html.replace(dataUrl, `cid:${cid}`);
    return { html: newHtml, attachments: [attachment] };
  }

  // Otherwise treat branding.logoUrl as a local path (skip remote http(s)).
  if (/^https?:\/\//i.test(logo)) return { html, attachments: [] };
  const path = logo.startsWith('file://') ? fileURLToPath(logo) : logo;
  if (!existsSync(path)) return { html, attachments: [] };
  const filename = basename(path);
  const attachment: MailAttachment = { filename, path, cid };
  // Try to replace any src that references the filename with the CID.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`src="[^"]*${esc(filename)}[^"]*"`);
  let newHtml = html.replace(re, `src="cid:${cid}"`);
  if (newHtml === html) newHtml = html.replace(/src="[^"]+"/, `src="cid:${cid}"`);
  return { html: newHtml, attachments: [attachment] };
}
