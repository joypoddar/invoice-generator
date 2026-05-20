import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { renderInvoiceNumber, totalFor, type Config, type Invoice } from '@invoice/shared';
import { SqliteStore, prepareClone } from '@invoice/core';
import { dbPath, loadConfigSafe, saveConfig } from '../store.js';
import { exitWithResolveError, resolveInvoice } from '../resolver.js';
import { performSend } from './send.js';
import { bumpCustomerSeq } from '../customers.js';
import { resolveNumberSpec } from '../invoice-number.js';

export { prepareClone };

interface CloneOptions {
  send?: boolean;
  yes?: boolean;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
}

export function register(program: Command): void {
  program
    .command('clone <id>')
    .description(
      'Duplicate an existing invoice as a fresh draft (new id/number/dates; same customer + line items)',
    )
    .option('--send', 'send the new invoice immediately after creating it')
    .option('-y, --yes', 'skip the send confirmation prompt (only meaningful with --send)')
    .option('--to <email...>', 'override recipients for the chained send')
    .option('--cc <email...>', 'override cc recipients for the chained send')
    .option('--bcc <email...>', 'override bcc recipients for the chained send')
    .option('--subject <text>', 'override subject template for the chained send')
    .action(runClone);
}

async function runClone(sourceId: string, opts: CloneOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  let cloned: Invoice;
  let numberSpec: ReturnType<typeof resolveNumberSpec>;
  try {
    const result = await resolveInvoice(store, sourceId);
    if (!result.ok) exitWithResolveError(sourceId, result);
    const source = result.invoice;

    const sourceSlug =
      typeof source.default.customerSlug === 'string'
        ? source.default.customerSlug
        : undefined;
    numberSpec = resolveNumberSpec(config, sourceSlug);

    const today = new Date();
    const issueDate = toIsoDate(today);
    const dueDate = toIsoDate(addDays(today, config.invoice.defaultDueDays));
    const invoiceNumber = renderInvoiceNumber(
      numberSpec.format,
      numberSpec.seq,
      today,
      numberSpec.companyName,
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

  const updatedConfig: Config = numberSpec.customerSlug
    ? bumpCustomerSeq(config, numberSpec.customerSlug)
    : {
        ...config,
        invoice: { ...config.invoice, nextSeq: config.invoice.nextSeq + 1 },
      };
  saveConfig(updatedConfig);

  const customerName = String(cloned.default.customerName ?? '');
  const currency = String(cloned.default.currency ?? '');
  console.log(`\nCloned ${String(cloned.default.invoiceNumber)}`);
  console.log(`  id:       ${cloned.id}`);
  console.log(`  from:     ${String(cloned.default.fromName ?? '')}`);
  console.log(`  customer: ${customerName}`);
  console.log(`  issue:    ${String(cloned.default.issueDate ?? '')}`);
  console.log(`  due:      ${String(cloned.default.dueDate ?? '')}`);
  console.log(`  total:    ${totalFor(cloned).toFixed(2)} ${currency}`);

  if (opts.send) {
    const status = await performSend(updatedConfig, cloned, opts);
    if (status === 'error') process.exit(1);
    return;
  }

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
