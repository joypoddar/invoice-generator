import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { confirm, input, select } from '@inquirer/prompts';
import { renderInvoiceNumber, totalFor, type Invoice } from '@invoice/shared';
import {
  computeNextRun,
  FREQUENCIES,
  materializeFromTemplate,
  prepareClone,
  SqliteStore,
  type Frequency,
  type RecurringInvoice,
} from '@invoice/core';
import { dbPath, loadConfigSafe, saveConfig } from '../store.js';
import { listTemplates, loadTemplate, templateExists } from '../templates.js';

interface GenerateOptions {
  dryRun?: boolean;
}

interface DeleteOptions {
  yes?: boolean;
}

export function register(program: Command): void {
  const cmd = program
    .command('recurring')
    .description('Manage recurring invoice schedules (manual generation only — no daemon)');

  cmd
    .command('create')
    .description('Create a new recurring invoice (interactive)')
    .action(runCreate);

  cmd.command('list').description('List recurring invoices').action(runList);

  cmd.command('show <name>').description('Show full detail for a recurring invoice').action(runShow);

  cmd
    .command('delete <name>')
    .description('Delete a recurring invoice')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(runDelete);

  cmd
    .command('generate')
    .description('Generate drafts for all recurrings whose next_run is on or before today')
    .option('--dry-run', 'print what would happen without writing')
    .action(runGenerate);
}

async function runCreate(): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  const sourceKind = (await select({
    message: 'Source for the recurring invoice:',
    choices: [
      { name: 'Existing invoice (by id)', value: 'invoice' as const },
      { name: 'Saved template (by name)', value: 'template' as const },
    ],
  })) as 'invoice' | 'template';

  let sourceRef: string;
  if (sourceKind === 'invoice') {
    sourceRef = await input({
      message: 'Source invoice id:',
      required: true,
    });
    const store = new SqliteStore(dbPath());
    try {
      const inv = await store.get(sourceRef);
      if (!inv) {
        console.error(`No invoice with id: ${sourceRef}`);
        process.exit(1);
      }
    } finally {
      store.close();
    }
  } else {
    const names = listTemplates();
    if (names.length === 0) {
      console.error('No templates exist. Save one first with `invoice template save <id> <name>`.');
      process.exit(1);
    }
    sourceRef = await select({
      message: 'Pick a template:',
      choices: names.map((n) => ({ name: n, value: n })),
    });
  }

  const frequency = (await select({
    message: 'Frequency:',
    choices: FREQUENCIES.map((f) => ({ name: f, value: f })),
  })) as Frequency;

  const today = toIsoDate(new Date());
  const startDate = await input({
    message: 'Start date (ISO YYYY-MM-DD):',
    default: today,
    required: true,
    validate: validateIsoDate,
  });
  const endDateRaw = await input({
    message: 'End date (optional, blank for no end):',
    default: '',
    validate: (v: string) => v === '' || validateIsoDate(v),
  });

  const name = await input({
    message: 'Name (alphanumeric, .-_):',
    required: true,
    validate: (v: string) => /^[A-Za-z0-9._-]+$/.test(v) || 'Use alphanumeric + .-_ only',
  });

  const store = new SqliteStore(dbPath());
  try {
    if (store.getRecurring(name)) {
      console.error(`A recurring named "${name}" already exists. Delete it first or pick another name.`);
      process.exit(1);
    }

    const rec: RecurringInvoice = {
      id: randomUUID(),
      name,
      sourceKind,
      sourceRef,
      frequency,
      startDate,
      nextRun: startDate,
      createdAt: new Date().toISOString(),
    };
    if (endDateRaw !== '') rec.endDate = endDateRaw;

    store.createRecurring(rec);
  } finally {
    store.close();
  }

  console.log(`\nCreated recurring "${name}".`);
  console.log(`  source:    ${sourceKind} = ${sourceRef}`);
  console.log(`  frequency: ${frequency}`);
  console.log(`  starts:    ${startDate}${endDateRaw !== '' ? ` (ends ${endDateRaw})` : ''}`);
  console.log(`\nRun \`invoice recurring generate\` to materialize drafts.`);
}

function runList(): void {
  const store = new SqliteStore(dbPath());
  let recs: RecurringInvoice[];
  try {
    recs = store.listRecurrings();
  } finally {
    store.close();
  }
  if (recs.length === 0) {
    console.log('No recurring invoices. Create one with `invoice recurring create`.');
    return;
  }
  const rows = recs.map((r) => [
    r.name,
    `${r.sourceKind}:${r.sourceRef}`,
    r.frequency,
    r.nextRun,
    r.lastRun ?? '-',
    r.endDate ?? '-',
  ]);
  console.log(renderTable(['Name', 'Source', 'Freq', 'Next run', 'Last run', 'End'], rows));
}

function runShow(name: string): void {
  const store = new SqliteStore(dbPath());
  let rec: RecurringInvoice | null;
  try {
    rec = store.getRecurring(name);
  } finally {
    store.close();
  }
  if (!rec) {
    console.error(`No recurring named "${name}".`);
    process.exit(1);
  }
  console.log(JSON.stringify(rec, null, 2));
}

async function runDelete(name: string, opts: DeleteOptions): Promise<void> {
  const store = new SqliteStore(dbPath());
  try {
    const rec = store.getRecurring(name);
    if (!rec) {
      console.error(`No recurring named "${name}".`);
      process.exit(1);
    }
    if (!opts.yes) {
      const ok = await confirm({ message: `Delete recurring "${name}"?`, default: false });
      if (!ok) {
        console.log('Aborted.');
        return;
      }
    }
    store.deleteRecurring(name);
  } finally {
    store.close();
  }
  console.log(`Deleted recurring "${name}".`);
}

async function runGenerate(opts: GenerateOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }
  const todayIso = toIsoDate(new Date());

  const store = new SqliteStore(dbPath());
  const created: { name: string; invoiceNumber: string; id: string; issueDate: string }[] = [];
  let mutableNextSeq = config.invoice.nextSeq;
  try {
    const due = store.findDueRecurrings(todayIso);
    if (due.length === 0) {
      console.log('No recurrings are due. Nothing to generate.');
      return;
    }

    for (const rec of due) {
      // Walk forward in time, generating one draft per missed period until
      // next_run exceeds today (or end_date if set).
      let nextRunIso = rec.nextRun;
      while (
        nextRunIso <= todayIso &&
        (rec.endDate === undefined || nextRunIso <= rec.endDate)
      ) {
        const issueDate = nextRunIso;
        const dueDate = toIsoDate(
          addDays(new Date(nextRunIso), config.invoice.defaultDueDays),
        );
        const invoiceNumber = renderInvoiceNumber(
          config.invoice.numberFormat,
          mutableNextSeq,
          new Date(issueDate),
        );
        const id = randomUUID();

        const newInvoice = await buildInvoice(rec, store, {
          id,
          invoiceNumber,
          issueDate,
          dueDate,
        });

        if (!opts.dryRun) {
          await store.upsert(newInvoice);
        }

        created.push({ name: rec.name, invoiceNumber, id, issueDate });
        mutableNextSeq += 1;

        // Advance next_run
        const nextDate = computeNextRun(new Date(nextRunIso), rec.frequency);
        nextRunIso = toIsoDate(nextDate);
      }

      if (!opts.dryRun) {
        store.updateRecurringRun(rec.id, nextRunIso, new Date().toISOString());
      }
    }
  } finally {
    store.close();
  }

  if (!opts.dryRun && mutableNextSeq !== config.invoice.nextSeq) {
    saveConfig({
      ...config,
      invoice: { ...config.invoice, nextSeq: mutableNextSeq },
    });
  }

  const prefix = opts.dryRun ? '[dry-run] ' : '';
  console.log(`${prefix}Generated ${created.length} draft(s):`);
  for (const c of created) {
    console.log(`  ${c.name}: ${c.invoiceNumber} (issue ${c.issueDate}, id ${c.id})`);
  }
  if (created.length > 0 && !opts.dryRun) {
    console.log(`\nReview with \`invoice list\`. Send each with \`invoice send <id>\`.`);
  }
}

async function buildInvoice(
  rec: RecurringInvoice,
  store: SqliteStore,
  overrides: { id: string; invoiceNumber: string; issueDate: string; dueDate: string },
): Promise<Invoice> {
  if (rec.sourceKind === 'invoice') {
    const source = await store.get(rec.sourceRef);
    if (!source) {
      throw new Error(
        `Recurring "${rec.name}" references invoice id ${rec.sourceRef} which no longer exists`,
      );
    }
    return prepareClone(source, overrides);
  }
  if (!templateExists(rec.sourceRef)) {
    throw new Error(
      `Recurring "${rec.name}" references template "${rec.sourceRef}" which no longer exists`,
    );
  }
  const template = loadTemplate(rec.sourceRef);
  if (!template) {
    throw new Error(`Recurring "${rec.name}" template "${rec.sourceRef}" failed to load`);
  }
  return materializeFromTemplate(template, overrides);
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

function validateIsoDate(v: string): boolean | string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Use ISO format YYYY-MM-DD';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  return true;
}

// Suppress unused-import lint while leaving `totalFor` available for a future
// "expected total" column in `recurring list`.
void totalFor;
