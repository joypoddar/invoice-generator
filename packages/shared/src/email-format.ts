import { totalFor, type Invoice } from './invoice.js';

export const INVOICE_HEADER_NAME = 'X-Invoice-Generator';
export const INVOICE_HEADER_VALUE = '1';

export function subjectFor(invoice: Invoice): string {
  const number = invoice.default.invoiceNumber as string;
  const customer = (invoice.default.customerName as string | undefined) ?? '';
  const currency = (invoice.default.currency as string | undefined) ?? '';
  const total = totalFor(invoice).toFixed(2);
  return `[Invoice] ${number} — ${customer} — ${total} ${currency}`.trim();
}

export function sidecarFilenameFor(invoiceNumber: string): string {
  return `invoice-${invoiceNumber}.json`;
}
