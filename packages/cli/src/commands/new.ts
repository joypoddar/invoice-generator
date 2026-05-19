import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { confirm, input } from '@inquirer/prompts';
import { renderInvoiceNumber, type Invoice, type LineItem } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe, saveConfig } from '../store.js';
import { readMultiline } from './init.js';

export function register(program: Command): void {
  program
    .command('new')
    .description('Create a new invoice (interactive)')
    .action(runNew);
}

async function runNew(): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const today = new Date();
  const issueDate = toIsoDate(today);
  const dueDate = toIsoDate(addDays(today, config.invoice.defaultDueDays));
  const invoiceNumber = renderInvoiceNumber(
    config.invoice.numberFormat,
    config.invoice.nextSeq,
    today,
    config.company.name,
  );
  const invoiceId = randomUUID();

  console.log(`\nNew invoice: ${invoiceNumber}`);
  console.log(`  id: ${invoiceId}\n`);

  const customerName = await input({ message: 'Customer name:', required: true });
  const customerEmail = await input({ message: 'Customer email:', default: '' });
  const customerAddress = await readMultiline('Customer address (optional)');
  const currency = await input({ message: 'Currency:', default: config.currency });

  console.log('\nLine items:');
  const lineItems: LineItem[] = [];
  let addItem = true;
  while (addItem) {
    const description = await input({ message: '  Description:', required: true });
    const quantity = Number(await input({ message: '  Quantity:', default: '1' }));
    const unitPrice = Number(await input({ message: '  Unit price:', default: '0' }));
    if (Number.isNaN(quantity) || Number.isNaN(unitPrice)) {
      console.error('  Quantity and unit price must be numbers; skipping this line item.');
    } else {
      lineItems.push({ description, quantity, unitPrice });
    }
    addItem = await confirm({ message: '  Add another line item?', default: false });
  }

  if (lineItems.length === 0) {
    console.error('At least one line item is required.');
    process.exit(1);
  }

  const notes = await input({
    message: 'Notes (optional):',
    default: config.invoice.defaultNotes ?? '',
  });

  const custom: Record<string, unknown> = {};
  let addCustom = await confirm({ message: 'Add additional fields?', default: false });
  while (addCustom) {
    const key = await input({ message: '  Field name:', required: true });
    const valueRaw = await input({ message: `  Value for ${key}:`, required: true });
    custom[key] = coerce(valueRaw);
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

  saveConfig({
    ...config,
    invoice: { ...config.invoice, nextSeq: config.invoice.nextSeq + 1 },
  });

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
    lineItems: i.lineItems,
    lineItemHeader: c.invoice.lineItemHeader,
    currency: i.currency,
    taxRate: i.taxRate,
    taxLabel: i.taxLabel,
    taxAmount: i.taxAmount,
    bankAccountName: c.bank.accountName,
    bankAccountNumber: c.bank.accountNumber,
    bankIfsc: c.bank.ifsc,
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
