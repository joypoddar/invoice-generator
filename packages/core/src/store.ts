import type { Invoice } from '@invoice/shared';

export type SortField =
  | 'invoiceNumber'
  | 'issueDate'
  | 'dueDate'
  | 'sentAt'
  | 'total'
  | 'fromName'
  | 'customerName'
  | 'paymentStatus';

export interface SortSpec {
  field: SortField;
  direction: 'asc' | 'desc';
}

export interface InvoiceFilter {
  text?: string;
  dueBefore?: string;
  dueAfter?: string;
  paymentStatus?: 'paid' | 'unpaid';
  overdue?: boolean;
  hasCustomFields?: boolean;
  fromEmail?: string;
  customerName?: string;
}

export type AggregateSpec =
  | { kind: 'totalsByStatus' }
  | { kind: 'topSenders'; limit: number }
  | { kind: 'topCustomers'; limit: number }
  | { kind: 'monthlyTrend' };

export type AggregateResult = unknown;

export interface UpsertOptions {
  messageUid?: string;
}

export interface InvoiceStore {
  list(filter?: InvoiceFilter, sort?: SortSpec): Promise<Invoice[]>;
  get(id: string): Promise<Invoice | null>;
  upsert(invoice: Invoice, opts?: UpsertOptions): Promise<void>;
  delete(id: string): Promise<void>;
  count(filter?: InvoiceFilter): Promise<number>;
  aggregate(spec: AggregateSpec): Promise<AggregateResult>;
  close(): void;
}
