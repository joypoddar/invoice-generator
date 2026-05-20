import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { ConfigSchema, type Config } from '@invoice/shared';
import { loadConfigSafe, saveConfig } from '../store.js';
import {
  deleteCustomer,
  getCustomer,
  listCustomers,
  setCustomer,
  slugFor,
} from '../customers.js';
import { setupCustomer } from './init.js';

interface DeleteOptions {
  yes?: boolean;
}

interface SaveOptions {
  force?: boolean;
}

export function register(program: Command): void {
  const cmd = program
    .command('customer')
    .description('Manage saved customers (used as the Billed To picker in `invoice new`)');

  cmd
    .command('save')
    .description('Save a new customer (or update an existing one with --force)')
    .option('--force', 'overwrite an existing customer with the same slug')
    .action(runSave);

  cmd.command('list').description('List all saved customers').action(runList);

  cmd
    .command('show <name-or-slug>')
    .description('Print full details for a customer')
    .action(runShow);

  cmd
    .command('delete <name-or-slug>')
    .description('Delete a saved customer')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(runDelete);
}

function requireConfig(): Config {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }
  return config;
}

async function runSave(opts: SaveOptions): Promise<void> {
  const config = requireConfig();
  const data = await setupCustomer();
  const slug = slugFor(data.name);
  if (!slug) {
    console.error('Customer name must contain at least one alphanumeric character.');
    process.exit(1);
  }

  if (config.customers[slug] && !opts.force) {
    console.error(
      `Customer "${slug}" already exists. Re-run with --force to overwrite, or use ` +
        `\`invoice customer delete ${slug}\` first.`,
    );
    process.exit(1);
  }

  const next = ConfigSchema.parse(setCustomer(config, slug, data));
  saveConfig(next);
  console.log(`Saved customer "${data.name}" (slug: ${slug}).`);
}

function runList(): void {
  const config = requireConfig();
  const rows = listCustomers(config);
  if (rows.length === 0) {
    console.log('No customers saved yet. Use `invoice customer save` to add one.');
    return;
  }
  const tableRows = rows.map(([slug, c]) => [
    slug,
    c.name,
    c.email ?? '-',
    c.defaultRecipientTo.join(', ') || '-',
    c.defaultRecipientCc.length > 0 ? c.defaultRecipientCc.join(', ') : '-',
  ]);
  const headers = ['Slug', 'Name', 'Email', 'Default To', 'Default Cc'];
  console.log(renderTable(headers, tableRows));
}

function runShow(ref: string): void {
  const config = requireConfig();
  const customer = getCustomer(config, ref);
  if (!customer) {
    console.error(`No customer matching: ${ref}`);
    process.exit(1);
  }
  console.log(JSON.stringify(customer, null, 2));
}

async function runDelete(ref: string, opts: DeleteOptions): Promise<void> {
  const config = requireConfig();
  const customer = getCustomer(config, ref);
  if (!customer) {
    console.error(`No customer matching: ${ref}`);
    process.exit(1);
  }
  if (!opts.yes) {
    const ok = await confirm({
      message: `Delete customer "${customer.name}"?`,
      default: false,
    });
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }
  const slug = slugFor(customer.name);
  const next = ConfigSchema.parse(deleteCustomer(config, slug));
  saveConfig(next);
  console.log(`Deleted customer "${customer.name}".`);
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const pad = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w));
  return [pad(headers), pad(sep), ...rows.map(pad)].join('\n');
}
