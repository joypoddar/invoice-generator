import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { totalFor, type Invoice } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe } from '../store.js';
import { getPassword, SMTP_PASSWORD_ACCOUNT } from '../secrets.js';
import { sendInvoice, type Recipients, type RenderOpts } from '../email.js';

interface SendOptions {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  yes?: boolean;
}

export function register(program: Command): void {
  program
    .command('send <id>')
    .description('Render and email an invoice (confirms recipients first; --yes to skip)')
    .option('--to <email...>', 'override recipients (replaces config)')
    .option('--cc <email...>', 'override cc recipients')
    .option('--bcc <email...>', 'override bcc recipients')
    .option(
      '--subject <text>',
      'override subject template for this send (placeholders: {invoiceNumber}, {customerName}, {total}, {currency}, {issueDate}, {dueDate})',
    )
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(runSend);
}

async function runSend(id: string, opts: SendOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const password = getPassword(SMTP_PASSWORD_ACCOUNT);
  if (!password) {
    console.error('SMTP password not in keychain. Run `invoice init` to set it.');
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  let invoice: Invoice | null;
  try {
    invoice = await store.get(id);
  } finally {
    // re-opened later if/when we update the row; keep this scope tight
    store.close();
  }
  if (!invoice) {
    console.error(`No invoice with id: ${id}`);
    process.exit(1);
  }
  if (invoice.status === 'sent') {
    console.error(
      `Invoice ${String(invoice.default.invoiceNumber)} was already sent at ${invoice.sentAt}.`,
    );
    process.exit(1);
  }

  const recipients = composeRecipients(config.mail.recipients, opts);
  if (recipients.to.length === 0) {
    console.error('No recipients in `to` (set via --to or `mail.recipients.to` in config).');
    process.exit(1);
  }

  printSummary(invoice, recipients, config.smtp.user);

  const shouldConfirm = !opts.yes && config.cli.confirmBeforeSend;
  if (shouldConfirm) {
    const ok = await confirm({ message: 'Send?', default: false });
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }

  // Build the sent-state invoice BEFORE sending so the JSON sidecar attached
  // to the email matches what we will write locally. If we sent the draft
  // version, a future `invoice sync` would overwrite the locally-marked-sent
  // row with the original draft state.
  const sentInvoice: Invoice = {
    ...invoice,
    status: 'sent',
    sentAt: new Date().toISOString(),
    recipients,
  };

  console.log('Sending…');
  const renderOpts: RenderOpts = {
    branding: config.branding,
    dateFormat: config.invoice.dateFormat,
    currencyFormat: config.invoice.currencyFormat,
    subjectTemplate: opts.subject ?? config.mail.subjectTemplate,
  };
  await sendInvoice(
    sentInvoice,
    recipients,
    { host: config.smtp.host, port: config.smtp.port, user: config.smtp.user },
    password,
    renderOpts,
  );

  const writeStore = new SqliteStore(dbPath());
  try {
    await writeStore.upsert(sentInvoice);
  } finally {
    writeStore.close();
  }

  console.log(`Sent. ${String(sentInvoice.default.invoiceNumber)} → ${recipients.to.join(', ')}`);
}

function composeRecipients(
  base: { to: string[]; cc: string[]; bcc: string[] },
  opts: SendOptions,
): Recipients {
  return {
    to: opts.to ?? base.to,
    cc: opts.cc ?? base.cc,
    bcc: opts.bcc ?? base.bcc,
  };
}

function printSummary(invoice: Invoice, recipients: Recipients, fromAddress: string): void {
  const def = invoice.default;
  const total = totalFor(invoice).toFixed(2);
  const currency = String(def.currency ?? '');
  console.log(
    `\nInvoice ${String(def.invoiceNumber)} — ${String(def.customerName ?? '')} — ${total} ${currency}`,
  );
  console.log(`  From: ${fromAddress}`);
  console.log(`  To:   ${recipients.to.join(', ')}`);
  if (recipients.cc && recipients.cc.length > 0) console.log(`  Cc:   ${recipients.cc.join(', ')}`);
  if (recipients.bcc && recipients.bcc.length > 0)
    console.log(`  Bcc:  ${recipients.bcc.join(', ')}`);
  console.log(`  Body: HTML invoice summary + JSON sidecar attachment`);
  console.log('');
}
