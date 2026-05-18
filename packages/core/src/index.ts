export type {
  AggregateResult,
  AggregateSpec,
  InvoiceFilter,
  InvoiceStore,
  SortField,
  SortSpec,
  UpsertOptions,
} from './store.js';

export { SqliteStore } from './sqlite-store.js';
export { list } from './queries.js';

export {
  connect,
  listFolders,
  fetchSince,
  type ImapConfig,
  type FolderInfo,
  type FetchedMessage,
} from './imap.js';

export { ingest, parseSidecar, type IngestResult } from './ingest.js';

export {
  FREQUENCIES,
  computeNextRun,
  isFrequency,
  materializeFromTemplate,
  prepareClone,
  templateFromInvoice,
  type Frequency,
  type RecurringInvoice,
  type Template,
  type MaterializeOverrides,
} from './recurring.js';
