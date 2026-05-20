import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { ConfigSchema, totalFor, type Config, type Invoice } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe, saveConfig } from '../store.js';
import { getPassword, SMTP_PASSWORD_ACCOUNT } from '../secrets.js';
import { sendInvoice, type Recipients, type RenderOpts } from '../email.js';
import { exitWithResolveError, resolveInvoice } from '../resolver.js';
import { composeRecipients } from '../recipients.js';
import { getCustomer, setCustomer, slugFor } from '../customers.js';
import { setupCustomer } from './init.js';

interface SendOptions {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  yes?: boolean;
}

export type PerformSendOptions = SendOptions;
export type PerformSendStatus = 'sent' | 'aborted' | 'error';

export function register(program: Command): void {
  program
    .command('send <id>')
    .description('Render and email an invoice (confirms recipients first; --yes to skip)')
    .option('--to <email...>', 'override recipients (replaces config)')
    .option('--cc <email...>', 'override cc recipients')
    .option('--bcc <email...>', 'override bcc recipients')
    .option(
      '--subject <text>',
      'override subject template for this send (see `invoice setup mail` for the full placeholder list)',
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

  const store = new SqliteStore(dbPath());
  let invoice: Invoice;
  try {
    const result = await resolveInvoice(store, id);
    if (!result.ok) exitWithResolveError(id, result);
    invoice = result.invoice;
  } finally {
    store.close();
  }

  const status = await performSend(config, invoice, opts);
  if (status === 'error') process.exit(1);
}

/**
 * Send a draft invoice end-to-end: compose recipients, confirm, SMTP-send,
 * persist sent state, then offer to save the customer for future use.
 *
 * Used by `invoice send` and chained from `clone --send`, `template use --send`,
 * `recurring generate --send`. Errors print to stderr and return `'error'` —
 * the caller decides whether to exit.
 */
export async function performSend(
  config: Config,
  invoice: Invoice,
  opts: PerformSendOptions,
): Promise<PerformSendStatus> {
  if (invoice.status === 'sent') {
    console.error(
      `Invoice ${String(invoice.default.invoiceNumber)} was already sent at ${invoice.sentAt}.`,
    );
    return 'error';
  }

  const password = getPassword(SMTP_PASSWORD_ACCOUNT);
  if (!password) {
    console.error('SMTP password not in keychain. Run `invoice init` to set it.');
    return 'error';
  }

  const recipients = composeRecipients(config, invoice, opts);
  if (recipients.to.length === 0) {
    console.error('No recipients in `to` (set via --to or `mail.recipients.to` in config).');
    return 'error';
  }

  printSummary(invoice, recipients, config.smtp.user);

  const shouldConfirm = !opts.yes && config.cli.confirmBeforeSend;
  if (shouldConfirm) {
    const ok = await confirm({ message: 'Send?', default: false });
    if (!ok) {
      console.log('Aborted.');
      return 'aborted';
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
    branding: {
      ...config.branding,
      signatoryLabel: config.branding.signatoryLabel,
    },
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

  await maybePromptSaveCustomer(config, sentInvoice, recipients);
  return 'sent';
}

async function maybePromptSaveCustomer(
  config: Config,
  invoice: Invoice,
  recipients: Recipients,
): Promise<void> {
  const slug =
    typeof invoice.default.customerSlug === 'string'
      ? invoice.default.customerSlug
      : undefined;
  // Already linked to a saved customer? Don't ask.
  if (slug && getCustomer(config, slug)) return;

  const name =
    typeof invoice.default.customerName === 'string'
      ? invoice.default.customerName.trim()
      : '';
  if (!name) return;

  // Already in directory by display name (case-insensitive)? Don't ask.
  if (getCustomer(config, name)) return;

  const ok = await confirm({
    message: `Save "${name}" as a customer for next time?`,
    default: true,
  });
  if (!ok) return;

  const data = await setupCustomer({
    name,
    email: optString(invoice.default.customerEmail),
    address: optString(invoice.default.customerAddress),
    defaultRecipientTo: recipients.to,
    defaultRecipientCc: recipients.cc ?? [],
  });

  const saveSlug = slugFor(data.name);
  if (!saveSlug) {
    console.log('  Skipped saving: name must contain at least one alphanumeric character.');
    return;
  }
  if (config.customers[saveSlug]) {
    console.log(
      `  Skipped saving: slug "${saveSlug}" already exists. Use \`invoice customer save --force\` to update.`,
    );
    return;
  }

  const next = ConfigSchema.parse(setCustomer(config, saveSlug, data));
  saveConfig(next);
  console.log(`  Saved customer "${data.name}" (slug: ${saveSlug}).`);
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
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
