import type { Command } from 'commander';
import { totalFor, type Invoice } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe } from '../store.js';

export function register(program: Command): void {
  program
    .command('list')
    .description('List invoices from the local database')
    .action(runList);
}

async function runList(): Promise<void> {
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

  const rows = invoices.map((inv) => {
    const def = inv.default;
    return [
      String(def.invoiceNumber ?? ''),
      String(def.customerName ?? ''),
      String(def.dueDate ?? ''),
      inv.status,
      String(def.currency ?? '') ? `${totalFor(inv).toFixed(2)} ${String(def.currency)}` : totalFor(inv).toFixed(2),
      inv.paymentStatus,
      inv.sentAt ?? '-',
    ];
  });
  const headers = ['Number', 'Customer', 'Due', 'Status', 'Total', 'Paid?', 'Sent'];
  console.log(renderTable(headers, rows));
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const pad = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w));
  return [pad(headers), pad(sep), ...rows.map(pad)].join('\n');
}
