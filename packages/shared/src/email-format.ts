import { totalFor, type Invoice } from './invoice.js';

export const INVOICE_HEADER_NAME = 'X-Invoice-Generator';
export const INVOICE_HEADER_VALUE = '1';

/** The built-in default subject when neither config nor --subject sets a template. */
export function subjectFor(invoice: Invoice): string {
  const number = invoice.default.invoiceNumber as string;
  const customer = (invoice.default.customerName as string | undefined) ?? '';
  const currency = (invoice.default.currency as string | undefined) ?? '';
  const total = totalFor(invoice).toFixed(2);
  return `[Invoice] ${number} — ${customer} — ${total} ${currency}`.trim();
}

/**
 * Substitute the six supported placeholders into a subject template.
 * Unknown braces are left as-is so they're visible in the output and the user
 * notices the typo. Missing invoice fields render as empty strings.
 */
export function renderSubject(template: string, invoice: Invoice): string {
  const def = invoice.default;
  const values: Record<string, string> = {
    invoiceNumber: stringOrEmpty(def.invoiceNumber),
    customerName: stringOrEmpty(def.customerName),
    currency: stringOrEmpty(def.currency),
    total: totalFor(invoice).toFixed(2),
    issueDate: stringOrEmpty(def.issueDate),
    dueDate: stringOrEmpty(def.dueDate),
  };
  return template
    .replaceAll('{invoiceNumber}', values.invoiceNumber!)
    .replaceAll('{customerName}', values.customerName!)
    .replaceAll('{currency}', values.currency!)
    .replaceAll('{total}', values.total!)
    .replaceAll('{issueDate}', values.issueDate!)
    .replaceAll('{dueDate}', values.dueDate!);
}

export function sidecarFilenameFor(invoiceNumber: string): string {
  return `invoice-${invoiceNumber}.json`;
}

function stringOrEmpty(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}
