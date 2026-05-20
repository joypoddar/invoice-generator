import type { Command } from 'commander';
import { totalFor, type Invoice } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe } from '../store.js';
import { mostRecent } from '../recency.js';

interface LastOptions {
  drafts?: boolean;
}

export function register(program: Command): void {
  program
    .command('last')
    .description('Print the most-recently-touched invoice (highest issueDate / sentAt)')
    .option('--drafts', 'only consider drafts')
    .action(runLast);
}

async function runLast(opts: LastOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  let all: Invoice[];
  try {
    all = await store.list();
  } finally {
    store.close();
  }

  const inv = mostRecent(all, { drafts: opts.drafts });
  if (!inv) {
    console.log(opts.drafts ? 'No drafts found.' : 'No invoices yet. Create one with `invoice new`.');
    return;
  }

  printDetail(inv);
}

function printDetail(inv: Invoice): void {
  const def = inv.default;
  const currency = String(def.currency ?? '');
  const total = totalFor(inv).toFixed(2);
  const lines: string[] = [
    `Id:        ${inv.id.slice(0, 8)}`,
    `Full id:   ${inv.id}`,
    `Number:    ${String(def.invoiceNumber ?? '')}`,
    `Customer:  ${String(def.customerName ?? '')}`,
    `From:      ${String(def.fromName ?? '')}`,
    `Issued:    ${String(def.issueDate ?? '')}`,
    `Due:       ${String(def.dueDate ?? '')}`,
    `Status:    ${inv.status}`,
    `Total:     ${total}${currency ? ` ${currency}` : ''}`,
    `Paid?:     ${inv.paymentStatus}${inv.paidAt ? ` (${inv.paidAt})` : ''}`,
  ];
  if (inv.status === 'sent') {
    lines.push(`Sent:      ${inv.sentAt ?? '-'}`);
    if (inv.recipients) {
      lines.push(`Sent to:   ${inv.recipients.to.join(', ') || '-'}`);
      if (inv.recipients.cc && inv.recipients.cc.length > 0) {
        lines.push(`     cc:   ${inv.recipients.cc.join(', ')}`);
      }
      if (inv.recipients.bcc && inv.recipients.bcc.length > 0) {
        lines.push(`     bcc:  ${inv.recipients.bcc.join(', ')}`);
      }
    }
  }
  console.log(lines.join('\n'));
}
