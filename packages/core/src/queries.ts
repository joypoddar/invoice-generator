import type { Invoice } from '@invoice/shared';
import type { InvoiceFilter, InvoiceStore, SortSpec } from './store.js';

export async function list(
  store: InvoiceStore,
  filter?: InvoiceFilter,
  sort?: SortSpec,
): Promise<Invoice[]> {
  return store.list(filter, sort);
}
