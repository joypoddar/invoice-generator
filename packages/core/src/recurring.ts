import { type Invoice, type LineItem } from '@invoice/shared';

// ───── Recurring data model ─────

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export const FREQUENCIES: readonly Frequency[] = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export interface RecurringInvoice {
  id: string;
  name: string;
  sourceKind: 'invoice' | 'template';
  /** invoice.id if sourceKind='invoice'; template name if sourceKind='template' */
  sourceRef: string;
  frequency: Frequency;
  startDate: string;
  endDate?: string;
  nextRun: string;
  lastRun?: string;
  createdAt: string;
}

// ───── Template (filesystem-stored partial Invoice) ─────

export interface Template {
  default: Record<string, unknown>;
  custom: Record<string, unknown>;
}

// ───── Pure transforms (shared by clone, template, recurring) ─────

const STRIPPED_DEFAULT_KEYS = ['invoiceNumber', 'issueDate', 'dueDate', 'taxAmount'];

export interface MaterializeOverrides {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
}

/**
 * Duplicate an Invoice as a fresh draft. Customer/line-items/bank/company/
 * tax/notes/custom are preserved; identity (id, number, dates) is replaced;
 * send/payment state is reset.
 */
export function prepareClone(source: Invoice, overrides: MaterializeOverrides): Invoice {
  return {
    id: overrides.id,
    default: {
      ...source.default,
      invoiceNumber: overrides.invoiceNumber,
      issueDate: overrides.issueDate,
      dueDate: overrides.dueDate,
    },
    custom: { ...source.custom },
    status: 'draft',
    paymentStatus: 'unpaid',
  };
}

/**
 * Project an Invoice down to a Template by dropping per-send identity (id,
 * invoiceNumber, dates, taxAmount) and per-send state.
 */
export function templateFromInvoice(invoice: Invoice): Template {
  const def: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(invoice.default)) {
    if (!STRIPPED_DEFAULT_KEYS.includes(k)) def[k] = v;
  }
  return { default: def, custom: { ...invoice.custom } };
}

/**
 * Materialize an Invoice from a Template. Mirrors prepareClone but the source
 * has no per-send identity. Recomputes taxAmount from rate + line items so
 * hand-edits to the template stay consistent.
 */
export function materializeFromTemplate(
  template: Template,
  overrides: MaterializeOverrides,
): Invoice {
  const def: Record<string, unknown> = {
    ...template.default,
    invoiceNumber: overrides.invoiceNumber,
    issueDate: overrides.issueDate,
    dueDate: overrides.dueDate,
  };

  const taxRate = def.taxRate;
  const items = def.lineItems;
  if (typeof taxRate === 'number' && Array.isArray(items)) {
    const subtotal = (items as LineItem[]).reduce((s, it) => s + it.quantity * it.unitPrice, 0);
    def.taxAmount = subtotal * taxRate;
  }

  return {
    id: overrides.id,
    default: def,
    custom: { ...template.custom },
    status: 'draft',
    paymentStatus: 'unpaid',
  };
}

// ───── Scheduling ─────

/**
 * Advance a date by one period of the given frequency. JavaScript's Date
 * arithmetic handles month-end rollovers naively (Jan 31 + 1 month → Mar 3),
 * but for v1 this is fine — the typical use case is "1st of every month".
 */
export function computeNextRun(from: Date, frequency: Frequency): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

export function isFrequency(v: unknown): v is Frequency {
  return typeof v === 'string' && (FREQUENCIES as readonly string[]).includes(v);
}
