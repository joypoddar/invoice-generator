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
 * Substitute the supported placeholders into a subject template.
 * Unknown braces are left as-is so they're visible in the output and the user
 * notices the typo. Missing invoice fields render as empty strings.
 *
 * Supported placeholders:
 *   Invoice:  {invoiceNumber} {total} {currency} {issueDate} {dueDate}
 *   Customer: {customerName} {customerEmail}
 *   Sender:   {userName} {userEmail} {companyName}
 *   Date pieces (parsed from {issueDate}, UTC-stable, en-US month names):
 *             {month} {monthShort} {monthNum} {year} {yearShort} {day} {dayPadded}
 */
export function renderSubject(template: string, invoice: Invoice): string {
  const def = invoice.default;
  const values: Record<string, string> = {
    invoiceNumber: stringOrEmpty(def.invoiceNumber),
    customerName: stringOrEmpty(def.customerName),
    customerEmail: stringOrEmpty(def.customerEmail),
    userName: stringOrEmpty(def.fromName),
    userEmail: stringOrEmpty(def.fromEmail),
    companyName: stringOrEmpty(def.companyName),
    currency: stringOrEmpty(def.currency),
    total: totalFor(invoice).toFixed(2),
    issueDate: stringOrEmpty(def.issueDate),
    dueDate: stringOrEmpty(def.dueDate),
    ...datePartsOf(stringOrEmpty(def.issueDate)),
  };
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}

export function sidecarFilenameFor(invoiceNumber: string): string {
  return `invoice-${invoiceNumber}.json`;
}

function stringOrEmpty(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v);
}

// Parsed as UTC so the rendered month/day never shifts based on the host
// timezone — an issueDate of "2026-05-17" must always say "May 17", everywhere.
function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function datePartsOf(iso: string): Record<string, string> {
  const empty = {
    month: '',
    monthShort: '',
    monthNum: '',
    year: '',
    yearShort: '',
    day: '',
    dayPadded: '',
  };
  const date = parseIsoDate(iso);
  if (!date) return empty;
  const monthLong = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
  const monthShort = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
  const yearStr = String(date.getUTCFullYear());
  const dayNum = date.getUTCDate();
  return {
    month: monthLong,
    monthShort,
    monthNum: String(date.getUTCMonth() + 1).padStart(2, '0'),
    year: yearStr,
    yearShort: yearStr.slice(-2),
    day: String(dayNum),
    dayPadded: String(dayNum).padStart(2, '0'),
  };
}
