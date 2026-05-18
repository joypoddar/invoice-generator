import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { hasCustomFields, totalFor, type Invoice } from '@invoice/shared';
import type {
  AggregateResult,
  AggregateSpec,
  InvoiceFilter,
  InvoiceStore,
  SortField,
  SortSpec,
  UpsertOptions,
} from './store.js';
import type { Frequency, RecurringInvoice } from './recurring.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  message_uid TEXT UNIQUE,
  invoice_number TEXT NOT NULL,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  issue_date TEXT,
  due_date TEXT,
  sent_at TEXT,
  currency TEXT,
  total REAL,
  has_custom_fields INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  paid_at TEXT,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_uid INTEGER
);

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('invoice','template')),
  source_ref TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  next_run TEXT NOT NULL,
  last_run TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_from ON invoices(from_email);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_name);
CREATE INDEX IF NOT EXISTS idx_invoices_payment ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_has_custom ON invoices(has_custom_fields);
CREATE INDEX IF NOT EXISTS idx_recurring_next_run ON recurring_invoices(next_run);
`;

const SORT_COLUMN: Record<SortField, string> = {
  invoiceNumber: 'invoice_number',
  issueDate: 'issue_date',
  dueDate: 'due_date',
  sentAt: 'sent_at',
  total: 'total',
  fromName: 'from_name',
  customerName: 'customer_name',
  paymentStatus: 'payment_status',
};

export class SqliteStore implements InvoiceStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  async upsert(invoice: Invoice, opts?: UpsertOptions): Promise<void> {
    const def = invoice.default;
    const total = totalFor(invoice);
    const customFlag = hasCustomFields(invoice) ? 1 : 0;

    this.db
      .prepare(
        `INSERT INTO invoices (
          id, message_uid, invoice_number, from_name, from_email,
          customer_name, customer_email, issue_date, due_date, sent_at,
          currency, total, has_custom_fields, payment_status, paid_at, raw_json
        ) VALUES (
          :id, :message_uid, :invoice_number, :from_name, :from_email,
          :customer_name, :customer_email, :issue_date, :due_date, :sent_at,
          :currency, :total, :has_custom_fields, :payment_status, :paid_at, :raw_json
        )
        ON CONFLICT(id) DO UPDATE SET
          message_uid = COALESCE(excluded.message_uid, invoices.message_uid),
          invoice_number = excluded.invoice_number,
          from_name = excluded.from_name,
          from_email = excluded.from_email,
          customer_name = excluded.customer_name,
          customer_email = excluded.customer_email,
          issue_date = excluded.issue_date,
          due_date = excluded.due_date,
          sent_at = excluded.sent_at,
          currency = excluded.currency,
          total = excluded.total,
          has_custom_fields = excluded.has_custom_fields,
          payment_status = excluded.payment_status,
          paid_at = excluded.paid_at,
          raw_json = excluded.raw_json`,
      )
      .run({
        id: invoice.id,
        message_uid: opts?.messageUid ?? null,
        invoice_number: String(def.invoiceNumber ?? ''),
        from_name: String(def.fromName ?? ''),
        from_email: String(def.fromEmail ?? ''),
        customer_name: optionalString(def.customerName),
        customer_email: optionalString(def.customerEmail),
        issue_date: optionalString(def.issueDate),
        due_date: optionalString(def.dueDate),
        sent_at: invoice.sentAt ?? null,
        currency: optionalString(def.currency),
        total,
        has_custom_fields: customFlag,
        payment_status: invoice.paymentStatus,
        paid_at: invoice.paidAt ?? null,
        raw_json: JSON.stringify(invoice),
      });
  }

  async get(id: string): Promise<Invoice | null> {
    const row = this.db.prepare('SELECT raw_json FROM invoices WHERE id = ?').get(id) as
      | { raw_json: string }
      | undefined;
    return row ? (JSON.parse(row.raw_json) as Invoice) : null;
  }

  async list(filter?: InvoiceFilter, sort?: SortSpec): Promise<Invoice[]> {
    const { whereSql, params } = buildWhere(filter);
    const sortField = sort?.field ?? 'issueDate';
    const sortDir = sort?.direction === 'asc' ? 'ASC' : 'DESC';
    const sql = `SELECT raw_json FROM invoices ${whereSql} ORDER BY ${SORT_COLUMN[sortField]} ${sortDir}`;
    const rows = this.db.prepare(sql).all(...params) as { raw_json: string }[];
    return rows.map((r) => JSON.parse(r.raw_json) as Invoice);
  }

  async count(filter?: InvoiceFilter): Promise<number> {
    const { whereSql, params } = buildWhere(filter);
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM invoices ${whereSql}`)
      .get(...params) as { cnt: number };
    return row.cnt;
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  }

  async aggregate(_spec: AggregateSpec): Promise<AggregateResult> {
    throw new Error('aggregate() is not implemented in Phase 1');
  }

  getLastUid(): number {
    const row = this.db.prepare('SELECT last_uid FROM sync_state WHERE id = 1').get() as
      | { last_uid: number | null }
      | undefined;
    return row?.last_uid ?? 0;
  }

  setLastUid(uid: number): void {
    this.db
      .prepare(
        `INSERT INTO sync_state (id, last_uid) VALUES (1, :uid)
         ON CONFLICT(id) DO UPDATE SET last_uid = :uid`,
      )
      .run({ uid });
  }

  // ───── Recurring invoices ─────

  createRecurring(rec: RecurringInvoice): void {
    this.db
      .prepare(
        `INSERT INTO recurring_invoices
         (id, name, source_kind, source_ref, frequency, start_date, end_date, next_run, last_run, created_at)
         VALUES (:id, :name, :source_kind, :source_ref, :frequency, :start_date, :end_date, :next_run, :last_run, :created_at)`,
      )
      .run({
        id: rec.id,
        name: rec.name,
        source_kind: rec.sourceKind,
        source_ref: rec.sourceRef,
        frequency: rec.frequency,
        start_date: rec.startDate,
        end_date: rec.endDate ?? null,
        next_run: rec.nextRun,
        last_run: rec.lastRun ?? null,
        created_at: rec.createdAt,
      });
  }

  listRecurrings(): RecurringInvoice[] {
    const rows = this.db
      .prepare('SELECT * FROM recurring_invoices ORDER BY name ASC')
      .all() as unknown as RecurringRow[];
    return rows.map(rowToRecurring);
  }

  getRecurring(name: string): RecurringInvoice | null {
    const row = this.db
      .prepare('SELECT * FROM recurring_invoices WHERE name = ?')
      .get(name) as unknown as RecurringRow | undefined;
    return row ? rowToRecurring(row) : null;
  }

  deleteRecurring(name: string): boolean {
    const result = this.db.prepare('DELETE FROM recurring_invoices WHERE name = ?').run(name);
    return result.changes > 0;
  }

  updateRecurringRun(id: string, nextRun: string, lastRun: string): void {
    this.db
      .prepare(
        'UPDATE recurring_invoices SET next_run = :next, last_run = :last WHERE id = :id',
      )
      .run({ next: nextRun, last: lastRun, id });
  }

  /** Recurrings whose next_run is on or before the given ISO date AND not past end_date. */
  findDueRecurrings(asOf: string): RecurringInvoice[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM recurring_invoices
         WHERE next_run <= :asOf
           AND (end_date IS NULL OR next_run <= end_date)
         ORDER BY next_run ASC, name ASC`,
      )
      .all({ asOf }) as unknown as RecurringRow[];
    return rows.map(rowToRecurring);
  }

  close(): void {
    this.db.close();
  }
}

interface RecurringRow {
  id: string;
  name: string;
  source_kind: 'invoice' | 'template';
  source_ref: string;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  next_run: string;
  last_run: string | null;
  created_at: string;
}

function rowToRecurring(row: RecurringRow): RecurringInvoice {
  const rec: RecurringInvoice = {
    id: row.id,
    name: row.name,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    frequency: row.frequency,
    startDate: row.start_date,
    nextRun: row.next_run,
    createdAt: row.created_at,
  };
  if (row.end_date !== null) rec.endDate = row.end_date;
  if (row.last_run !== null) rec.lastRun = row.last_run;
  return rec;
}

function optionalString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length > 0 ? s : null;
}

function buildWhere(filter?: InvoiceFilter): { whereSql: string; params: SQLInputValue[] } {
  if (!filter) return { whereSql: '', params: [] };
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];

  if (filter.text) {
    clauses.push('(invoice_number LIKE ? OR customer_name LIKE ? OR raw_json LIKE ?)');
    const pattern = `%${filter.text}%`;
    params.push(pattern, pattern, pattern);
  }
  if (filter.dueBefore) {
    clauses.push('due_date < ?');
    params.push(filter.dueBefore);
  }
  if (filter.dueAfter) {
    clauses.push('due_date > ?');
    params.push(filter.dueAfter);
  }
  if (filter.paymentStatus) {
    clauses.push('payment_status = ?');
    params.push(filter.paymentStatus);
  }
  if (filter.overdue) {
    clauses.push("payment_status = 'unpaid' AND due_date < date('now')");
  }
  if (filter.hasCustomFields !== undefined) {
    clauses.push('has_custom_fields = ?');
    params.push(filter.hasCustomFields ? 1 : 0);
  }
  if (filter.fromEmail) {
    clauses.push('from_email = ?');
    params.push(filter.fromEmail);
  }
  if (filter.customerName) {
    clauses.push('customer_name = ?');
    params.push(filter.customerName);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereSql, params };
}
