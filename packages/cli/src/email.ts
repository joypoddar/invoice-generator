import { createTransport, type SendMailOptions } from 'nodemailer';
import {
  INVOICE_HEADER_NAME,
  INVOICE_HEADER_VALUE,
  renderSubject,
  sidecarFilenameFor,
  subjectFor,
  type Invoice,
} from '@invoice/shared';
import { renderInvoiceHtml, type BrandingOpts, type RenderOpts } from '@invoice/renderer';

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
