export const DEFAULT_FIELDS = [
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'fromName',
  'fromEmail',
  'customerName',
  'customerEmail',
  'lineItems',
  'currency',
  'notes',
] as const;

export type DefaultField = (typeof DEFAULT_FIELDS)[number];

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Invoice {
  id: string;
  default: Record<string, unknown>;
  custom: Record<string, unknown>;
  status: 'draft' | 'sent';
  sentAt?: string;
  recipients?: { to: string[]; cc?: string[]; bcc?: string[] };
  paymentStatus: 'paid' | 'unpaid';
  paidAt?: string;
}

const SEQ_PAD = 4;

export function renderInvoiceNumber(format: string, seq: number, date: Date = new Date()): string {
  const seqStr = String(seq).padStart(SEQ_PAD, '0');
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return format
    .replaceAll('{SEQ}', seqStr)
    .replaceAll('{YYYY}', yyyy)
    .replaceAll('{MM}', mm)
    .replaceAll('{DD}', dd);
}

export function totalFor(invoice: Invoice): number {
  const items = (invoice.default.lineItems as LineItem[] | undefined) ?? [];
  return items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
}

export function hasCustomFields(invoice: Invoice): boolean {
  return Object.keys(invoice.custom).length > 0;
}
