import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { renderInvoiceNumber, totalFor, type Config } from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe, saveConfig } from '../store.js';
import {
  deleteTemplate,
  listTemplates,
  loadTemplate,
  materializeFromTemplate,
  saveTemplate,
  templateExists,
  templateFromInvoice,
} from '../templates.js';
import { performSend } from './send.js';
import { bumpCustomerSeq } from '../customers.js';
import { resolveNumberSpec } from '../invoice-number.js';

interface UseOptions {
  send?: boolean;
  yes?: boolean;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
}

export function register(program: Command): void {
  const cmd = program
    .command('template')
    .description('Save / list / use / delete invoice templates');

  cmd
    .command('save <id> <name>')
    .description('Save an existing invoice as a named template')
    .action(runSave);

  cmd.command('list').description('List saved templates').action(runList);

  cmd
    .command('use <name>')
    .description('Create a new draft invoice from a template (fresh id/number/dates)')
    .option('--send', 'send the new invoice immediately after creating it')
    .option('-y, --yes', 'skip the send confirmation prompt (only meaningful with --send)')
    .option('--to <email...>', 'override recipients for the chained send')
    .option('--cc <email...>', 'override cc recipients for the chained send')
    .option('--bcc <email...>', 'override bcc recipients for the chained send')
    .option('--subject <text>', 'override subject template for the chained send')
    .action(runUse);

  cmd
    .command('delete <name>')
    .description('Delete a saved template')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(runDelete);
}

async function runSave(sourceId: string, name: string): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  if (templateExists(name)) {
    console.error(`Template "${name}" already exists. Delete it first or pick another name.`);
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  try {
    const source = await store.get(sourceId);
    if (!source) {
      console.error(`No invoice with id: ${sourceId}`);
      process.exit(1);
    }
    const template = templateFromInvoice(source);
    saveTemplate(name, template);
    console.log(`Saved template "${name}" from invoice ${String(source.default.invoiceNumber)}.`);
  } finally {
    store.close();
  }
}

function runList(): void {
  const names = listTemplates();
  if (names.length === 0) {
    console.log('No templates yet. Save one with `invoice template save <id> <name>`.');
    return;
  }
  const rows = names.map((name) => {
    const t = loadTemplate(name);
    return [
      name,
      String(t?.default.customerName ?? ''),
      String(t?.default.currency ?? ''),
      String(t?.default.fromName ?? ''),
    ];
  });
  console.log(renderTable(['Name', 'Customer', 'Currency', 'From'], rows));
}

async function runUse(name: string, opts: UseOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const template = loadTemplate(name);
  if (!template) {
    console.error(`No template named "${name}".`);
    process.exit(1);
  }

  const templateSlug =
    typeof template.default.customerSlug === 'string'
      ? template.default.customerSlug
      : undefined;
  const numberSpec = resolveNumberSpec(config, templateSlug);

  const today = new Date();
  const issueDate = toIsoDate(today);
  const dueDate = toIsoDate(addDays(today, config.invoice.defaultDueDays));
  const invoiceNumber = renderInvoiceNumber(
    numberSpec.format,
    numberSpec.seq,
    today,
    numberSpec.companyName,
  );

  const invoice = materializeFromTemplate(template, {
    id: randomUUID(),
    invoiceNumber,
    issueDate,
    dueDate,
  });

  const store = new SqliteStore(dbPath());
  try {
    await store.upsert(invoice);
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

  console.log(`\nCreated draft ${String(invoice.default.invoiceNumber)} from template "${name}"`);
  console.log(`  id:       ${invoice.id}`);
  console.log(`  customer: ${String(invoice.default.customerName ?? '')}`);
  console.log(`  issue:    ${String(invoice.default.issueDate ?? '')}`);
  console.log(`  due:      ${String(invoice.default.dueDate ?? '')}`);
  console.log(
    `  total:    ${totalFor(invoice).toFixed(2)} ${String(invoice.default.currency ?? '')}`,
  );

  if (opts.send) {
    const status = await performSend(updatedConfig, invoice, opts);
    if (status === 'error') process.exit(1);
    return;
  }

  console.log(`\nReview with \`invoice list\` then send with \`invoice send ${invoice.id}\`.`);
}

async function runDelete(name: string, opts: { yes?: boolean }): Promise<void> {
  if (!templateExists(name)) {
    console.error(`No template named "${name}".`);
    process.exit(1);
  }
  if (!opts.yes) {
    const ok = await confirm({ message: `Delete template "${name}"?`, default: false });
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }
  deleteTemplate(name);
  console.log(`Deleted template "${name}".`);
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const pad = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w));
  return [pad(headers), pad(sep), ...rows.map(pad)].join('\n');
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
