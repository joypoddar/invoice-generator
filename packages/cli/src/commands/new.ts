import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { confirm, input } from '@inquirer/prompts';
import { renderInvoiceNumber, type Invoice, type LineItem } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe, saveConfig } from '../store.js';

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
  );

  console.log(`\nNew invoice: ${invoiceNumber} (id will be auto-generated)\n`);

  const customerName = await input({ message: 'Customer name:', required: true });
  const customerEmail = await input({ message: 'Customer email:', default: '' });
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

  const notes = await input({ message: 'Notes (optional):', default: '' });

  const custom: Record<string, unknown> = {};
  let addCustom = await confirm({ message: 'Add additional fields?', default: false });
  while (addCustom) {
    const key = await input({ message: '  Field name:', required: true });
    const valueRaw = await input({ message: `  Value for ${key}:`, required: true });
    custom[key] = coerce(valueRaw);
    addCustom = await confirm({ message: '  Add another?', default: false });
  }

  const invoice: Invoice = {
    id: randomUUID(),
    default: {
      invoiceNumber,
      issueDate,
      dueDate,
      fromName: config.name,
      fromEmail: config.email,
      customerName,
      customerEmail,
      lineItems,
      currency,
      notes,
    },
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

  const total = lineItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  console.log(`\nCreated draft ${invoiceNumber}`);
  console.log(`  id:       ${invoice.id}`);
  console.log(`  customer: ${customerName}`);
  console.log(`  due:      ${dueDate}`);
  console.log(`  total:    ${total.toFixed(2)} ${currency}`);
  console.log(`\nReview with \`invoice list\` or send with \`invoice send ${invoice.id}\`.`);
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
