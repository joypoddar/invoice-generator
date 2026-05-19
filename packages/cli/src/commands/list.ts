import type { Command } from 'commander';
import { totalFor, type Invoice } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe } from '../store.js';

const SHORT_ID_LEN = 8;

interface ListOptions {
  fullId?: boolean;
}

export function register(program: Command): void {
  program
    .command('list')
    .description('List invoices from the local database')
    .option('--full-id', 'show the full 36-char UUID instead of the 8-char short id')
    .action(runList);
}

async function runList(opts: ListOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  let invoices: Invoice[];
  try {
    invoices = await store.list();
  } finally {
    store.close();
  }

  if (invoices.length === 0) {
    console.log('No invoices yet. Create one with `invoice new`.');
    return;
  }

  const showFullId = !!opts.fullId;
  const rows = invoices.map((inv) => {
    const def = inv.default;
    const id = showFullId ? inv.id : inv.id.slice(0, SHORT_ID_LEN);
    return [
      id,
      String(def.invoiceNumber ?? ''),
      String(def.customerName ?? ''),
      String(def.dueDate ?? ''),
      inv.status,
      String(def.currency ?? '')
        ? `${totalFor(inv).toFixed(2)} ${String(def.currency)}`
        : totalFor(inv).toFixed(2),
      inv.paymentStatus,
      inv.sentAt ?? '-',
    ];
  });
  const headers = [
    showFullId ? 'Id (full)' : 'Id',
    'Number',
    'Customer',
    'Due',
    'Status',
    'Total',
    'Paid?',
    'Sent',
  ];
  console.log(renderTable(headers, rows));
  if (!showFullId) {
    console.log('\nUse the short id (first 8 chars), the full UUID, or the invoice number with `send`/`mark`/`clone`.');
  }
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const pad = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w));
  return [pad(headers), pad(sep), ...rows.map(pad)].join('\n');
}
