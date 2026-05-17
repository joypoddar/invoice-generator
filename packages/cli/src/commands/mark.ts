import type { Command } from 'commander';
import { type Invoice } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe } from '../store.js';

const VALID_STATUSES = ['paid', 'unpaid'] as const;
type PaymentStatus = (typeof VALID_STATUSES)[number];

export function register(program: Command): void {
  program
    .command('mark <id> <status>')
    .description('Mark an invoice as paid or unpaid')
    .action(runMark);
}

async function runMark(id: string, status: string): Promise<void> {
  if (!isPaymentStatus(status)) {
    console.error(`Status must be 'paid' or 'unpaid', got: ${status}`);
    process.exit(1);
  }

  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  try {
    const invoice = await store.get(id);
    if (!invoice) {
      console.error(`No invoice with id: ${id}`);
      process.exit(1);
    }

    const updated: Invoice = {
      ...invoice,
      paymentStatus: status,
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
    };
    await store.upsert(updated);

    console.log(`Marked ${String(invoice.default.invoiceNumber)} as ${status}.`);
  } finally {
    store.close();
  }
}

function isPaymentStatus(s: string): s is PaymentStatus {
  return (VALID_STATUSES as readonly string[]).includes(s);
}
