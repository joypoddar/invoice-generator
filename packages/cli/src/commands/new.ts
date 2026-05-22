import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { confirm, input, select } from '@inquirer/prompts';
import { renderInvoiceNumber, type Invoice, type LineItem } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe, saveConfig } from '../store.js';
import { readMultiline } from './init.js';
import { clearDraft, draftExists, loadDraft, saveDraft } from '../drafts.js';
import {
  bumpCustomerSeq,
  findCustomerSlug,
  getCustomer,
  listCustomers,
  type CustomerData,
} from '../customers.js';
import { resolveNumberSpec } from '../invoice-number.js';

interface NewDraft {
  invoiceId?: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  customerName?: string;
  customerEmail?: string;
  customerAddress?: string;
  customerPhone?: string;
  customerSlug?: string;
  currency?: string;
  lineItems?: LineItem[];
  notes?: string;
  custom?: Record<string, unknown>;
}

interface NewOptions {
  customer?: string;
}

export function register(program: Command): void {
  program
    .command('new')
    .description('Create a new invoice (interactive)')
    .option('--customer <name-or-slug>', 'pre-pick a saved customer (skips the picker)')
    .action(runNew);
}

async function runNew(opts: NewOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  // Draft persistence: resume from a prior interrupted session if present.
  let draft: NewDraft = {};
  if (draftExists('new')) {
    const resume = await confirm({
      message: 'Resume previous new-invoice session?',
      default: true,
    });
    if (resume) {
      draft = loadDraft<NewDraft>('new') ?? {};
    } else {
      clearDraft('new');
    }
  }
  const persist = (patch: Partial<NewDraft>): void => {
    draft = { ...draft, ...patch };
    saveDraft('new', draft);
  };

  const today = new Date();
  // Reuse identity from draft if resuming so the new invoice keeps a single
  // id / issue date across the resumed session. invoiceNumber is computed
  // later (after the customer step) so it can use the customer's numberFormat.
  const issueDate = draft.issueDate ?? toIsoDate(today);
  const dueDate =
    draft.dueDate ?? toIsoDate(addDays(today, config.invoice.defaultDueDays));
  const invoiceId = draft.invoiceId ?? randomUUID();
  persist({ invoiceId, issueDate, dueDate });

  // Customer step: pick from directory (--customer flag or interactive picker)
  // or fall through to fresh manual entry. A non-empty `draft.customerName`
  // means the prior session already chose and we should skip both the picker
  // and the per-field prompts.
  let customerSlug: string | undefined = draft.customerSlug;
  if (draft.customerName === undefined && opts.customer) {
    const picked = getCustomer(config, opts.customer);
    if (!picked) {
      console.error(
        `No customer matching "${opts.customer}". Use \`invoice customer list\` to see saved customers.`,
      );
      process.exit(1);
    }
    customerSlug = findCustomerSlug(config, opts.customer) ?? undefined;
    applyPickedCustomer(picked, customerSlug, persist);
  }
  if (draft.customerName === undefined) {
    const saved = listCustomers(config);
    if (saved.length > 0) {
      const NEW_SENTINEL = '__new__';
      const choice = await select({
        message: 'Bill to (pick a saved customer or create new):',
        choices: [
          ...saved.map(([slug, c]) => ({ name: c.name, value: slug })),
          { name: '+ New customer', value: NEW_SENTINEL },
        ],
        // Default to the first saved customer (alphabetical) so the common
        // path — billing an existing customer — is one Enter, and creating a
        // brand-new customer requires an explicit arrow-down.
        default: saved[0]?.[0],
      });
      if (choice !== NEW_SENTINEL) {
        const picked = getCustomer(config, choice);
        if (picked) {
          customerSlug = choice;
          applyPickedCustomer(picked, customerSlug, persist);
        }
      }
    }
  }

  // Per-field prompts only run when the data isn't already in the draft.
  // Picked customers populate draft.customerName (always) + email/address
  // (when present on the record). Resumed drafts populate everything that
  // the prior session collected. In both cases, `draft.X ?? input(...)`
  // skips the prompt — eliminating the "Press Enter on Line 1 to keep"
  // confusion entirely.
  const customerName =
    draft.customerName ?? (await input({ message: 'Customer name:', required: true }));
  if (draft.customerName === undefined) persist({ customerName });
  const customerEmail =
    draft.customerEmail ?? (await input({ message: 'Customer email:', default: '' }));
  if (draft.customerEmail === undefined) persist({ customerEmail });
  const customerAddress =
    draft.customerAddress ?? (await readMultiline('Customer address (optional)', undefined));
  if (draft.customerAddress === undefined) persist({ customerAddress });
  const customerPhone: string | undefined =
    draft.customerPhone ??
    ((await input({ message: 'Customer phone (optional):', default: '' })) || undefined);
  if (draft.customerPhone === undefined) persist({ customerPhone });

  // Now that customerSlug is locked in, resolve the right format/seq.
  const numberSpec = resolveNumberSpec(config, customerSlug);
  const invoiceNumber =
    draft.invoiceNumber ??
    renderInvoiceNumber(
      numberSpec.format,
      numberSpec.seq,
      new Date(issueDate),
      numberSpec.companyName,
    );
  persist({ invoiceNumber });

  console.log(`\nNew invoice: ${invoiceNumber}`);
  console.log(`  id: ${invoiceId}\n`);
  const currency = await input({
    message: 'Currency:',
    default: draft.currency ?? config.currency,
  });
  persist({ currency });

  console.log('\nLine items:');
  const lineItems: LineItem[] = draft.lineItems ? [...draft.lineItems] : [];
  if (lineItems.length > 0) {
    console.log(`  (${lineItems.length} item(s) from previous session — continuing where you left off)`);
  }
  let addItem = true;
  while (addItem) {
    const description = await input({ message: '  Description:', required: true });
    const quantity = Number(await input({ message: '  Quantity:', default: '1' }));
    const unitPrice = Number(await input({ message: '  Unit price:', default: '0' }));
    if (Number.isNaN(quantity) || Number.isNaN(unitPrice)) {
      console.error('  Quantity and unit price must be numbers; skipping this line item.');
    } else {
      lineItems.push({ description, quantity, unitPrice });
      persist({ lineItems });
    }
    addItem = await confirm({ message: '  Add another line item?', default: false });
  }

  if (lineItems.length === 0) {
    console.error('At least one line item is required.');
    process.exit(1);
  }

  const notes = await input({
    message: 'Notes (optional):',
    default: draft.notes ?? config.invoice.defaultNotes ?? '',
  });
  persist({ notes });

  const custom: Record<string, unknown> = { ...(draft.custom ?? {}) };
  let addCustom = await confirm({ message: 'Add additional fields?', default: false });
  while (addCustom) {
    const key = await input({ message: '  Field name:', required: true });
    const valueRaw = await input({ message: `  Value for ${key}:`, required: true });
    custom[key] = coerce(valueRaw);
    persist({ custom });
    addCustom = await confirm({ message: '  Add another?', default: false });
  }

  const subtotal = lineItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const taxRate = config.invoice.defaultTaxRate;
  const taxLabel = config.invoice.taxLabel;
  const taxAmount = typeof taxRate === 'number' ? subtotal * taxRate : undefined;

  const invoice: Invoice = {
    id: invoiceId,
    default: snapshotDefaults({
      invoiceNumber,
      issueDate,
      dueDate,
      config,
      customerName,
      customerEmail,
      customerAddress,
      customerPhone,
      customerSlug,
      currency,
      lineItems,
      taxRate,
      taxLabel,
      taxAmount,
      notes,
    }),
    custom,
    status: 'draft',
    paymentStatus: 'unpaid',
  };

  const store = new SqliteStore(dbPath());
  try {
    await store.upsert(invoice);
  } finally {
    store.close();
  }

  // Bump the counter that actually owns this invoice's number.
  const bumpedConfig = numberSpec.customerSlug
    ? bumpCustomerSeq(config, numberSpec.customerSlug)
    : {
        ...config,
        invoice: { ...config.invoice, nextSeq: config.invoice.nextSeq + 1 },
      };
  saveConfig(bumpedConfig);

  clearDraft('new');

  const total = subtotal + (taxAmount ?? 0);
  console.log(`\nCreated draft ${invoiceNumber}`);
  console.log(`  id:       ${invoice.id}`);
  console.log(`  customer: ${customerName}`);
  console.log(`  due:      ${dueDate}`);
  if (typeof taxAmount === 'number') {
    console.log(`  subtotal: ${subtotal.toFixed(2)} ${currency}`);
    console.log(`  tax:      ${taxAmount.toFixed(2)} ${currency} (${((taxRate ?? 0) * 100).toFixed(1)}%)`);
  }
  console.log(`  total:    ${total.toFixed(2)} ${currency}`);
  console.log(`\nReview with \`invoice list\` or send with \`invoice send ${invoice.id}\`.`);
}

interface SnapshotInputs {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  config: import('@invoice/shared').Config;
  customerName: string;
  customerEmail: string;
  customerAddress: string | undefined;
  customerPhone: string | undefined;
  customerSlug: string | undefined;
  currency: string;
  lineItems: LineItem[];
  taxRate: number | undefined;
  taxLabel: string | undefined;
  taxAmount: number | undefined;
  notes: string;
}

function snapshotDefaults(i: SnapshotInputs): Record<string, unknown> {
  const c = i.config;
  return omitUndefined({
    invoiceNumber: i.invoiceNumber,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    fromName: c.name,
    fromEmail: c.email,
    companyName: c.company.name,
    companyAddress: c.company.address,
    companyPhone: c.company.phone,
    companyWebsite: c.company.website,
    companyTaxId: c.company.taxId,
    customerName: i.customerName,
    customerEmail: i.customerEmail,
    customerAddress: i.customerAddress,
    customerPhone: i.customerPhone,
    customerSlug: i.customerSlug,
    lineItems: i.lineItems,
    lineItemHeader: c.invoice.lineItemHeader,
    currency: i.currency,
    taxRate: i.taxRate,
    taxLabel: i.taxLabel,
    taxAmount: i.taxAmount,
    bankAccountName: c.bank.accountName,
    bankAccountNumber: c.bank.accountNumber,
    bankIfsc: c.bank.ifsc?.toUpperCase(),
    bankAccountType: c.bank.accountType,
    bankName: c.bank.bankName,
    paymentInstructions: c.invoice.paymentInstructions,
    notes: i.notes,
  });
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function coerce(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function applyPickedCustomer(
  c: CustomerData,
  slug: string | undefined,
  persist: (patch: Partial<NewDraft>) => void,
): void {
  const patch: Partial<NewDraft> = { customerSlug: slug, customerName: c.name };
  if (c.email) patch.customerEmail = c.email;
  if (c.address) patch.customerAddress = c.address;
  if (c.phone) patch.customerPhone = c.phone;
  persist(patch);
  console.log(`  Using saved customer: ${c.name}`);
}
