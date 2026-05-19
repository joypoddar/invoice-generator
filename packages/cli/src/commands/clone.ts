import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { renderInvoiceNumber, totalFor, type Invoice } from '@invoice/shared';
import { SqliteStore, prepareClone } from '@invoice/core';
import { dbPath, loadConfigSafe, saveConfig } from '../store.js';
import { exitWithResolveError, resolveInvoice } from '../resolver.js';

export { prepareClone };

export function register(program: Command): void {
  program
    .command('clone <id>')
    .description(
      'Duplicate an existing invoice as a fresh draft (new id/number/dates; same customer + line items)',
    )
    .action(runClone);
}

async function runClone(sourceId: string): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  let cloned: Invoice;
  try {
    const result = await resolveInvoice(store, sourceId);
    if (!result.ok) exitWithResolveError(sourceId, result);
    const source = result.invoice;

    const today = new Date();
    const issueDate = toIsoDate(today);
    const dueDate = toIsoDate(addDays(today, config.invoice.defaultDueDays));
    const invoiceNumber = renderInvoiceNumber(
      config.invoice.numberFormat,
      config.invoice.nextSeq,
      today,
      config.company.name,
    );

    cloned = prepareClone(source, {
      id: randomUUID(),
      invoiceNumber,
      issueDate,
      dueDate,
    });

    await store.upsert(cloned);
  } finally {
    store.close();
  }

  saveConfig({
    ...config,
    invoice: { ...config.invoice, nextSeq: config.invoice.nextSeq + 1 },
  });

  const customerName = String(cloned.default.customerName ?? '');
  const currency = String(cloned.default.currency ?? '');
  console.log(`\nCloned ${String(cloned.default.invoiceNumber)}`);
  console.log(`  id:       ${cloned.id}`);
  console.log(`  from:     ${String(cloned.default.fromName ?? '')}`);
  console.log(`  customer: ${customerName}`);
  console.log(`  issue:    ${String(cloned.default.issueDate ?? '')}`);
  console.log(`  due:      ${String(cloned.default.dueDate ?? '')}`);
  console.log(`  total:    ${totalFor(cloned).toFixed(2)} ${currency}`);
  console.log(
    `\nReview with \`invoice list\`. Edit by hand if needed, then send with \`invoice send ${cloned.id}\`.`,
  );
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
