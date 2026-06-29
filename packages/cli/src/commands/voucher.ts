import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { confirm, input, select } from '@inquirer/prompts';
import open from 'open';
import {
  renderVoucherNumber,
  voucherTotal,
  type Config,
  type Voucher,
  type VoucherLine,
} from '@invoice/shared';
import { SqliteStore } from '@invoice/core';
import { startServer } from '@invoice/dashboard';
import { formatCurrency } from '@invoice/renderer';
import { dbPath, loadConfigSafe, saveConfig } from '../store.js';
import { clearDraft, draftExists, loadDraft, saveDraft } from '../drafts.js';
import {
  bumpCustomerSeq,
  findCustomerSlug,
  getCustomer,
  listCustomers,
  setCustomer,
  slugFor,
} from '../customers.js';
import { setupCustomer } from './init.js';
import { resolveVoucherNumberSpec } from '../voucher-number.js';

const DRAFT = 'voucher-new';

interface VoucherDraft {
  voucherId?: string;
  date?: string;
  payTo?: string;
  customerSlug?: string;
  currency?: string;
  lines?: VoucherLine[];
  preparedBy?: string;
  receivedBy?: string;
  notes?: string;
}

interface NewOptions {
  customer?: string;
}

export function resolveVoucherCompanyInfo(
  config: Config,
  customer: Config['customers'][string] | null | undefined,
): Pick<Voucher, 'companyName' | 'companyAddress'> {
  const companyName = customer?.name?.trim() || config.company.name || '';
  const companyAddress = customer?.address?.trim() || config.company.address || '';

  return {
    ...(companyName ? { companyName } : {}),
    ...(companyAddress ? { companyAddress } : {}),
  };
}

export function register(program: Command): void {
  const voucher = program.command('voucher').description('Create and print payment vouchers');

  voucher
    .command('new')
    .description('Create a new payment voucher (interactive)')
    .option('--customer <name-or-slug>', 'pre-pick the billed-to customer')
    .action(runNew);

  voucher.command('list').description('List saved payment vouchers').action(runList);

  voucher
    .command('print [id]')
    .description('Open the dashboard to print/save a voucher as PDF')
    .option('-p, --port <number>', 'override the dashboard port')
    .option('--no-open', 'start the server but do not open the browser')
    .action(runPrint);
}

async function runNew(opts: NewOptions): Promise<void> {
  let config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  let draft: VoucherDraft = {};
  if (draftExists(DRAFT)) {
    const resume = await confirm({
      message: 'Resume previous new-voucher session?',
      default: true,
    });
    if (resume) draft = loadDraft<VoucherDraft>(DRAFT) ?? {};
    else clearDraft(DRAFT);
  }
  const persist = (patch: Partial<VoucherDraft>): void => {
    draft = { ...draft, ...patch };
    saveDraft(DRAFT, draft);
  };

  const voucherId = draft.voucherId ?? randomUUID();
  const date = draft.date ?? toIsoDate(new Date());
  persist({ voucherId, date });

  let billingCustomerSlug = draft.customerSlug;
  if (!billingCustomerSlug && opts.customer) {
    const existingSlug = findCustomerSlug(config, opts.customer);
    if (existingSlug) {
      billingCustomerSlug = existingSlug;
      persist({ customerSlug: existingSlug });
    } else {
      const add = await confirm({
        message: `Customer "${opts.customer}" not found. Add as a saved customer?`,
        default: true,
      });
      if (!add) {
        console.error('Billing customer is required.');
        process.exit(1);
      }
      const newCustomer = await setupCustomer({ name: opts.customer });
      const slug = slugFor(newCustomer.name);
      if (!slug) {
        console.error('Customer name must contain an alphanumeric character.');
        process.exit(1);
      }
      config = setCustomer(config, slug, newCustomer);
      saveConfig(config);
      billingCustomerSlug = slug;
      persist({ customerSlug: slug });
    }
  }

  if (!billingCustomerSlug) {
    let saved = listCustomers(config);
    if (saved.length === 0) {
      console.log('No saved customers. A billed-to customer is required for vouchers.');
      const add = await confirm({ message: 'Add a customer now?', default: true });
      if (!add) {
        console.error('Billing customer is required.');
        process.exit(1);
      }
      const newCustomer = await setupCustomer();
      const slug = slugFor(newCustomer.name);
      if (!slug) {
        console.error('Customer name must contain an alphanumeric character.');
        process.exit(1);
      }
      config = setCustomer(config, slug, newCustomer);
      saveConfig(config);
      billingCustomerSlug = slug;
      persist({ customerSlug: slug });
      saved = listCustomers(config);
    }

    if (!billingCustomerSlug) {
      const NEW_CUSTOMER = '__new_customer__';
      const choice = await select({
        message: 'Billing to (select a saved customer):',
        choices: [
          ...saved.map(([slug, c]) => ({ name: c.name, value: slug })),
          { name: '+ Add new customer', value: NEW_CUSTOMER },
        ],
        default: saved[0]?.[0],
      });
      if (choice === NEW_CUSTOMER) {
        const newCustomer = await setupCustomer();
        const slug = slugFor(newCustomer.name);
        if (!slug) {
          console.error('Customer name must contain an alphanumeric character.');
          process.exit(1);
        }
        config = setCustomer(config, slug, newCustomer);
        saveConfig(config);
        billingCustomerSlug = slug;
        persist({ customerSlug: slug });
      } else {
        billingCustomerSlug = choice;
        persist({ customerSlug: choice });
      }
    }
  }

  let payTo = draft.payTo;
  if (payTo === undefined) {
    payTo = await input({ message: 'Payment to:', required: true });
    persist({ payTo });
  }

  const voucherDate = await input({ message: 'Date (YYYY-MM-DD):', default: date });
  persist({ date: voucherDate });

  const currency = await input({
    message: 'Currency:',
    default: draft.currency ?? config.currency,
  });
  persist({ currency });

  console.log('\nLine items:');
  const lines: VoucherLine[] = draft.lines ? [...draft.lines] : [];
  if (lines.length > 0) {
    console.log(
      `  (${lines.length} line(s) from previous session — continuing where you left off)`,
    );
  }
  let addItem = true;
  while (addItem) {
    const paymentMethod = await input({
      message: '  Payment method:',
      default: config.voucher.defaultPaymentMethod ?? '',
      required: true,
    });
    const description = await input({ message: '  Description:', required: true });
    const amount = Number(await input({ message: '  Amount:', default: '0' }));
    if (Number.isNaN(amount)) {
      console.error('  Amount must be a number; skipping this line.');
    } else {
      lines.push({ paymentMethod, description, amount });
      persist({ lines });
    }
    addItem = await confirm({ message: '  Add another line?', default: false });
  }
  if (lines.length === 0) {
    console.error('At least one line is required.');
    process.exit(1);
  }

  const preparedBy = await input({
    message: 'Prepared by:',
    default: draft.preparedBy ?? config.name,
  });
  persist({ preparedBy });
  const receivedBy = await input({
    message: 'Received by:',
    default: draft.receivedBy ?? config.name,
  });
  persist({ receivedBy });
  const notes = await input({ message: 'Notes (optional):', default: draft.notes ?? '' });
  persist({ notes });

  const spec = resolveVoucherNumberSpec(config, billingCustomerSlug);
  const voucherNumber = renderVoucherNumber(
    spec.format,
    spec.seq,
    new Date(voucherDate),
    spec.initials,
  );
  const companyInfo = resolveVoucherCompanyInfo(
    config,
    billingCustomerSlug ? getCustomer(config, billingCustomerSlug) : null,
  );

  const voucher: Voucher = {
    id: voucherId,
    voucherNumber,
    title: config.voucher.title,
    payTo,
    ...(billingCustomerSlug ? { customerSlug: billingCustomerSlug } : {}),
    date: voucherDate,
    currency,
    lines,
    ...companyInfo,
    preparedBy,
    receivedBy,
    ...(notes ? { notes } : {}),
    createdAt: new Date().toISOString(),
  };

  const store = new SqliteStore(dbPath());
  try {
    store.upsertVoucher(voucher);
  } finally {
    store.close();
  }

  if (billingCustomerSlug) {
    saveConfig(bumpCustomerSeq(config, billingCustomerSlug));
  } else {
    saveConfig({ ...config, voucher: { ...config.voucher, nextSeq: config.voucher.nextSeq + 1 } });
  }
  clearDraft(DRAFT);

  console.log(`\nCreated voucher ${voucherNumber}`);
  console.log(`  id:      ${voucher.id}`);
  console.log(`  pay to:  ${payTo}`);
  console.log(`  total:   ${formatCurrency(voucherTotal(voucher), currency)}`);
  console.log(`\nPrint it with \`invoice voucher print ${voucher.id}\`.`);
}

async function runList(): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }
  const store = new SqliteStore(dbPath());
  let vouchers: Voucher[];
  try {
    vouchers = store.listVouchers();
  } finally {
    store.close();
  }
  if (vouchers.length === 0) {
    console.log('No vouchers yet. Create one with `invoice voucher new`.');
    return;
  }
  for (const v of vouchers) {
    const total = formatCurrency(voucherTotal(v), v.currency || 'INR');
    console.log(`${v.voucherNumber}\t${v.date}\t${v.payTo}\t${total}\t${v.id.slice(0, 8)}`);
  }
}

interface PrintOptions {
  port?: string;
  noOpen?: boolean;
}

async function runPrint(id: string | undefined, opts: PrintOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const port = opts.port ? Number(opts.port) : config.dashboard.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${opts.port}`);
    process.exit(1);
  }

  let voucherPath = '/vouchers';
  if (id) {
    const store = new SqliteStore(dbPath());
    try {
      const match = resolveVoucher(store.listVouchers(), id);
      if (!match) {
        console.error(`No voucher matching "${id}".`);
        process.exit(1);
      }
      voucherPath = `/vouchers/${match.id}`;
    } finally {
      store.close();
    }
  }

  const server = startServer({
    port,
    dbPath: dbPath(),
    localUserName: config.name,
    renderOpts: {
      branding: { ...config.branding },
      dateFormat: config.invoice.dateFormat,
      currencyFormat: config.invoice.currencyFormat,
    },
  });

  const url = `http://127.0.0.1:${port}${voucherPath}`;
  console.log(`Dashboard running at http://127.0.0.1:${port}`);
  console.log(`  → ${url}`);
  console.log('Press Ctrl+C to stop.');

  if (opts.noOpen !== true) {
    try {
      await open(url);
    } catch {
      // headless / no DISPLAY — server still runs
    }
  }

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\nStopping dashboard…');
      void server.stop().then(() => resolve());
    });
  });
}

/** Resolve by full UUID, ≥4-char id prefix, or exact voucher number. */
function resolveVoucher(vouchers: Voucher[], ref: string): Voucher | null {
  const byId = vouchers.find((v) => v.id === ref);
  if (byId) return byId;
  const byNumber = vouchers.find((v) => v.voucherNumber === ref);
  if (byNumber) return byNumber;
  if (ref.length >= 4) {
    const byPrefix = vouchers.filter((v) => v.id.startsWith(ref));
    if (byPrefix.length === 1) return byPrefix[0]!;
  }
  return null;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
