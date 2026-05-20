import type { Command } from 'commander';
import { totalFor, type Invoice } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe } from '../store.js';

const SHORT_ID_LEN = 8;

export function register(program: Command): void {
  program
    .command('search <text>')
    .description('Find invoices whose number, customer name, or raw JSON contains text')
    .action(runSearch);
}

async function runSearch(text: string): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  let invoices: Invoice[];
  try {
    invoices = await store.list({ text });
  } finally {
    store.close();
  }

  if (invoices.length === 0) {
    console.log(`No invoices matching "${text}".`);
    return;
  }

  const rows = invoices.map((inv) => {
    const def = inv.default;
    return [
      inv.id.slice(0, SHORT_ID_LEN),
      String(def.invoiceNumber ?? ''),
      String(def.customerName ?? ''),
      String(def.dueDate ?? ''),
      inv.status,
      `${totalFor(inv).toFixed(2)} ${String(def.currency ?? '')}`.trim(),
      inv.paymentStatus,
    ];
  });
  const headers = ['Id', 'Number', 'Customer', 'Due', 'Status', 'Total', 'Paid?'];
  console.log(renderTable(headers, rows));
  console.log(`\n${invoices.length} match(es). Resolve any of them with \`send\`/\`mark\`/\`clone\`.`);
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const pad = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w));
  return [pad(headers), pad(sep), ...rows.map(pad)].join('\n');
}
