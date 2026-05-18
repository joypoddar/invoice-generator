import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type Invoice, type LineItem } from '@invoice/shared';
import { invoiceDir } from './store.js';

/**
 * On-disk template format. A template is a partial Invoice — same shape as
 * `Invoice` minus per-send identity fields (id, invoiceNumber, dates) and
 * per-send state (status, sentAt, recipients, paymentStatus, paidAt).
 */
export interface Template {
  default: Record<string, unknown>;
  custom: Record<string, unknown>;
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;

const STRIPPED_DEFAULT_KEYS = ['invoiceNumber', 'issueDate', 'dueDate', 'taxAmount'];

export function templatesDir(): string {
  return join(invoiceDir(), 'templates');
}

export function templatePath(name: string): string {
  validateName(name);
  return join(templatesDir(), `${name}.json`);
}

export function ensureTemplatesDir(): void {
  const dir = templatesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function templateExists(name: string): boolean {
  return existsSync(templatePath(name));
}

export function listTemplates(): string[] {
  const dir = templatesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

export function loadTemplate(name: string): Template | null {
  const path = templatePath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as Template;
}

export function saveTemplate(name: string, template: Template): void {
  ensureTemplatesDir();
  const path = templatePath(name);
  writeFileSync(path, JSON.stringify(template, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function deleteTemplate(name: string): boolean {
  const path = templatePath(name);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * Project an Invoice down to a Template by stripping per-send identity and
 * state. Customer, line items, bank/company snapshot, tax rate/label, payment
 * instructions, and notes are preserved.
 */
export function templateFromInvoice(invoice: Invoice): Template {
  const def: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(invoice.default)) {
    if (!STRIPPED_DEFAULT_KEYS.includes(k)) def[k] = v;
  }
  return {
    default: def,
    custom: { ...invoice.custom },
  };
}

/**
 * Materialize an Invoice from a Template with fresh identity/dates. Mirrors
 * `prepareClone` but the source is a template file rather than a stored row.
 * Recomputes taxAmount from the template's taxRate and line items.
 */
export function materializeFromTemplate(
  template: Template,
  overrides: { id: string; invoiceNumber: string; issueDate: string; dueDate: string },
): Invoice {
  const def: Record<string, unknown> = {
    ...template.default,
    invoiceNumber: overrides.invoiceNumber,
    issueDate: overrides.issueDate,
    dueDate: overrides.dueDate,
  };

  // Recompute taxAmount from rate + line items so the template stays current
  // even if line items are edited inside the template file.
  const taxRate = def.taxRate;
  const items = def.lineItems;
  if (typeof taxRate === 'number' && Array.isArray(items)) {
    const subtotal = (items as LineItem[]).reduce(
      (s, it) => s + it.quantity * it.unitPrice,
      0,
    );
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

function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Template name must be alphanumeric (with .-_); got: ${JSON.stringify(name)}`,
    );
  }
}
