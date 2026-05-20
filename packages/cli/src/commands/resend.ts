import type { Command } from 'commander';
import type { Invoice } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe } from '../store.js';
import { exitWithResolveError, resolveInvoice } from '../resolver.js';
import { performSend } from './send.js';

interface ResendOptions {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  yes?: boolean;
}

export function register(program: Command): void {
  program
    .command('resend <id>')
    .description('Re-send an already-sent invoice (updates sentAt + recipients)')
    .option('--to <email...>', 'override recipients for this send')
    .option('--cc <email...>', 'override cc recipients')
    .option('--bcc <email...>', 'override bcc recipients')
    .option(
      '--subject <text>',
      'override subject template for this send (see `invoice setup mail` for placeholders)',
    )
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(runResend);
}

async function runResend(id: string, opts: ResendOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  let invoice: Invoice;
  try {
    const result = await resolveInvoice(store, id);
    if (!result.ok) exitWithResolveError(id, result);
    invoice = result.invoice;
  } finally {
    store.close();
  }

  if (invoice.status !== 'sent') {
    console.error(
      'Invoice has never been sent. Use `invoice send` to send a draft for the first time.',
    );
    process.exit(1);
  }

  const prevSent = invoice.sentAt ?? '(unknown time)';
  const prevTo = invoice.recipients?.to.join(', ') ?? '(unknown)';
  console.log(`\n⚠ This invoice was already sent at ${prevSent} to ${prevTo}.`);
  console.log(`  Re-sending will update sentAt and the recipients snapshot to this attempt.`);

  // Hand performSend a draft-shaped clone so its already-sent guard doesn't
  // bail. The upsert at the end overwrites the row with the new sent state.
  const asDraft: Invoice = { ...invoice, status: 'draft' };
  const status = await performSend(config, asDraft, opts);
  if (status === 'error') process.exit(1);
}
