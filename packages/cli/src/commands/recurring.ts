import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { platform } from 'node:os';
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

  cmd
    .command('schedule-help')
    .description(
      'Print OS-specific scheduling instructions (cron / launchd / Task Scheduler). Print-only — never installs.',
    )
    .action(runScheduleHelp);
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

function runScheduleHelp(): void {
  const bin = resolveBinPath();
  const os = platform();
  const cmd = `${bin} recurring generate`;
  const log = '$HOME/.invoice/recurring.log';
  const cronLine = `5 9 * * * ${cmd} >> ${log} 2>&1`;

  console.log(`# Scheduling \`invoice recurring generate\``);
  console.log(`#`);
  console.log(
    `# This binary doesn't run a daemon. To get auto-generation, wire \`invoice recurring`,
  );
  console.log(
    `# generate\` into your OS scheduler. The snippet below runs once a day at 9:05 AM`,
  );
  console.log(`# and appends output to ~/.invoice/recurring.log.`);
  console.log(`#`);
  console.log(
    `# Generation always creates DRAFTS. \`invoice send <id>\` stays explicit so you`,
  );
  console.log(`# can review before any invoice goes out.`);
  console.log('');

  if (os === 'darwin') {
    printCron(cronLine);
    console.log('');
    printLaunchd(cmd, log);
  } else if (os === 'win32') {
    printSchtasks(cmd);
  } else {
    // Linux + everything else
    printCron(cronLine);
    console.log('');
    printSystemdTimer(cmd, log);
  }
}

function printCron(line: string): void {
  console.log('## Option: cron (Linux / macOS)');
  console.log('');
  console.log('1. Open your crontab:');
  console.log('     crontab -e');
  console.log('');
  console.log('2. Paste this line at the bottom (uses $HOME so it works for any user):');
  console.log('');
  console.log(`   ${line}`);
  console.log('');
  console.log('3. Save and exit. Verify with `crontab -l`.');
}

function printLaunchd(cmd: string, log: string): void {
  console.log('## Option: launchd (macOS — modern alternative to cron)');
  console.log('');
  console.log(
    'Create `~/Library/LaunchAgents/com.creowis.invoice.recurring.plist` with:',
  );
  console.log('');
  const [program, ...args] = cmd.split(' ');
  const argsXml = args
    .map((a) => `      <string>${escapeXml(a)}</string>`)
    .join('\n');
  console.log(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.creowis.invoice.recurring</string>
    <key>ProgramArguments</key>
    <array>
      <string>${escapeXml(program ?? 'invoice')}</string>
${argsXml}
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key><integer>9</integer>
      <key>Minute</key><integer>5</integer>
    </dict>
    <key>StandardOutPath</key><string>${log.replace('$HOME', '/Users/YOUR_USER')}</string>
    <key>StandardErrorPath</key><string>${log.replace('$HOME', '/Users/YOUR_USER')}</string>
  </dict>
</plist>`);
  console.log('');
  console.log('Then load:');
  console.log('     launchctl load ~/Library/LaunchAgents/com.creowis.invoice.recurring.plist');
}

function printSystemdTimer(cmd: string, log: string): void {
  console.log('## Option: systemd user timer (Linux — modern alternative to cron)');
  console.log('');
  console.log('Create `~/.config/systemd/user/invoice-recurring.service`:');
  console.log('');
  console.log(`[Unit]
Description=Generate due recurring invoice drafts

[Service]
Type=oneshot
ExecStart=/bin/sh -c '${cmd} >> ${log} 2>&1'`);
  console.log('');
  console.log('Create `~/.config/systemd/user/invoice-recurring.timer`:');
  console.log('');
  console.log(`[Unit]
Description=Run invoice-recurring daily at 09:05

[Timer]
OnCalendar=*-*-* 09:05:00
Persistent=true

[Install]
WantedBy=timers.target`);
  console.log('');
  console.log('Then enable + start:');
  console.log('     systemctl --user daemon-reload');
  console.log('     systemctl --user enable --now invoice-recurring.timer');
}

function printSchtasks(cmd: string): void {
  console.log('## Option: Task Scheduler (Windows)');
  console.log('');
  console.log('From PowerShell (one-time setup):');
  console.log('');
  console.log(`     schtasks /Create /SC DAILY /TN "InvoiceRecurring" \\
       /TR "${cmd}" /ST 09:05`);
  console.log('');
  console.log('Verify:');
  console.log('     schtasks /Query /TN "InvoiceRecurring"');
  console.log('');
  console.log('Remove:');
  console.log('     schtasks /Delete /TN "InvoiceRecurring" /F');
}

function resolveBinPath(): string {
  // process.argv[1] is the path used to invoke this command. Resolve symlinks
  // so the cron entry survives pnpm re-links.
  const arg = process.argv[1];
  if (!arg) return 'invoice';
  try {
    return realpathSync(arg);
  } catch {
    return arg;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
