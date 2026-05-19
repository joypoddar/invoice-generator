import type { Command } from 'commander';
import { confirm, input, password as passwordPrompt, select } from '@inquirer/prompts';
import { createTransport } from 'nodemailer';
import { ConfigSchema, type Config } from '@invoice/shared';
import { connect, listFolders, SqliteStore } from '@invoice/core';
import { dbPath, ensureInvoiceDir, loadConfigSafe, saveConfig } from '../store.js';
import {
  IMAP_PASSWORD_ACCOUNT,
  SMTP_PASSWORD_ACCOUNT,
  getPassword,
  setPassword,
} from '../secrets.js';

export function register(program: Command): void {
  program
    .command('init')
    .description('Interactive setup: identity, SMTP, IMAP (with folder picker), defaults')
    .action(runInit);
}

async function runInit(): Promise<void> {
  console.log('Setting up the `invoice` CLI.\n');
  const existing = loadConfigSafe();
  if (existing) console.log('Existing config found — press Enter to keep current values.\n');

  const name = await input({ message: 'Your name:', default: existing?.name, required: true });
  const email = await input({ message: 'Your email:', default: existing?.email, required: true });
  const currency = await input({
    message: 'Default currency (3-letter ISO code):',
    default: existing?.currency ?? 'INR',
  });
  const numberFormat = await input({
    message: 'Invoice number format (use {SEQ}/{YYYY}/{MM}/{DD}):',
    default: existing?.invoice.numberFormat ?? 'INV-{YYYY}-{SEQ}',
  });

  console.log('\n--- SMTP (sending) ---');
  const smtpHost = await input({
    message: 'SMTP host:',
    default: existing?.smtp.host ?? 'smtp.gmail.com',
  });
  const smtpPort = Number(
    await input({ message: 'SMTP port:', default: String(existing?.smtp.port ?? 465) }),
  );
  const smtpUser = await input({
    message: 'SMTP username:',
    default: existing?.smtp.user ?? email,
  });
  const smtpPassExisting = getPassword(SMTP_PASSWORD_ACCOUNT);
  const smtpPassInput = await passwordPrompt({
    message: `SMTP app password${smtpPassExisting ? ' (press Enter to keep current)' : ''}:`,
    mask: '*',
  });
  const smtpPass = smtpPassInput || smtpPassExisting;
  if (!smtpPass) throw new Error('SMTP password is required.');

  console.log('Testing SMTP…');
  const transporter = createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
  try {
    await transporter.verify();
    console.log('SMTP OK.');
  } finally {
    transporter.close();
  }

  console.log('\n--- IMAP (sync) ---');
  const imapHost = await input({
    message: 'IMAP host:',
    default: existing?.imap.host ?? 'imap.gmail.com',
  });
  const imapPort = Number(
    await input({ message: 'IMAP port:', default: String(existing?.imap.port ?? 993) }),
  );
  const imapUser = await input({
    message: 'IMAP username:',
    default: existing?.imap.user ?? smtpUser,
  });
  const imapPassExisting = getPassword(IMAP_PASSWORD_ACCOUNT);
  const imapPassInput = await passwordPrompt({
    message: `IMAP app password${imapPassExisting ? ' (press Enter to keep current)' : ''}:`,
    mask: '*',
  });
  const imapPass = imapPassInput || imapPassExisting;
  if (!imapPass) throw new Error('IMAP password is required.');

  console.log('Testing IMAP and listing folders…');
  const client = await connect({ host: imapHost, port: imapPort, user: imapUser }, imapPass);
  let folder: string;
  try {
    const folders = await listFolders(client);
    const ranked = [...folders].sort(
      (a, b) => specialRank(a.specialUse) - specialRank(b.specialUse),
    );
    folder = await select({
      message: 'Which mailbox folder should this install sync from?',
      choices: ranked.map((f) => ({
        name: f.specialUse ? `${f.path}  (${f.specialUse})` : f.path,
        value: f.path,
      })),
      default: existing?.imap.folder,
    });
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
  console.log(`IMAP OK. Folder: ${folder}`);

  console.log('\n--- Default recipients ---');
  const toCsv = await input({
    message: "Default 'to' (comma-separated email addresses):",
    default: existing?.mail.recipients.to.join(', ') ?? 'hello@creowis.com',
  });
  const toList = toCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const merged = mergeConfig(existing, {
    name,
    email,
    currency,
    numberFormat,
    smtp: { host: smtpHost, port: smtpPort, user: smtpUser },
    imap: { host: imapHost, port: imapPort, user: imapUser, folder },
    recipientsTo: toList,
  });
  const config = ConfigSchema.parse(merged);

  saveConfig(config);
  setPassword(SMTP_PASSWORD_ACCOUNT, smtpPass);
  setPassword(IMAP_PASSWORD_ACCOUNT, imapPass);

  ensureInvoiceDir();
  const store = new SqliteStore(dbPath());
  store.close();

  console.log('\nSetup complete. Try `invoice whoami`.');
}

function specialRank(use?: string): number {
  if (use === '\\Sent') return 0;
  if (use === '\\Inbox') return 1;
  return 9;
}

interface InitInputs {
  name: string;
  email: string;
  currency: string;
  numberFormat: string;
  smtp: { host: string; port: number; user: string };
  imap: { host: string; port: number; user: string; folder: string };
  recipientsTo: string[];
}

function mergeConfig(existing: Config | null, inputs: InitInputs): unknown {
  const base = (existing as unknown as Record<string, unknown>) ?? {};
  return {
    ...base,
    name: inputs.name,
    email: inputs.email,
    currency: inputs.currency,
    invoice: { ...(existing?.invoice ?? {}), numberFormat: inputs.numberFormat },
    smtp: inputs.smtp,
    imap: inputs.imap,
    mail: {
      ...(existing?.mail ?? {}),
      recipients: { ...(existing?.mail.recipients ?? {}), to: inputs.recipientsTo },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section helpers (used by Phase 4.6's `invoice setup <section>` + the extended
// init flow). Each takes the matching slice of existing config and returns the
// new slice. Empty inputs preserve whatever was there before.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Multi-line input. Prompts `Line N:` repeatedly until empty.
 * Pressing Enter immediately on the first line keeps the existing value (if any).
 * Returns undefined when there's no existing AND no lines entered.
 */
export async function readMultiline(label: string, existing?: string): Promise<string | undefined> {
  if (existing) {
    console.log(`  ${label} (current):`);
    console.log('    ' + existing.split('\n').join('\n    '));
    console.log('  Press Enter on Line 1 to keep, or type to replace (empty line ends).');
  } else {
    console.log(`  ${label} (line by line; empty line to finish):`);
  }
  const lines: string[] = [];
  let i = 1;
  while (true) {
    const line = await input({ message: `    Line ${i}:`, default: '' });
    if (line === '') {
      if (i === 1 && existing !== undefined) return existing;
      break;
    }
    lines.push(line);
    i++;
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/** Drop empty strings from an object so we don't write `field: ""` to config. */
function omitEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** First 3 non-whitespace chars of the company name, uppercased — matches `{COMPANY3}` substitution. */
function companyPrefix(name: string | undefined): string {
  if (!name) return '';
  return name.replace(/\s/g, '').slice(0, 3).toUpperCase();
}

export async function setupCompany(
  existing: Config['company'] = {},
): Promise<Config['company']> {
  console.log('\n--- Company info (shown in the Billed By section) ---');
  const name = await input({ message: 'Company name:', default: existing.name ?? '' });
  const address = await readMultiline('Company address', existing.address);
  const phone = await input({ message: 'Phone:', default: existing.phone ?? '' });
  const website = await input({ message: 'Website:', default: existing.website ?? '' });
  const taxId = await input({ message: 'Tax ID / GSTIN:', default: existing.taxId ?? '' });
  return omitEmpty({ name, address, phone, website, taxId }) as Config['company'];
}

export async function setupBank(existing: Config['bank'] = {}): Promise<Config['bank']> {
  console.log('\n--- Bank details (shown in the Bank Details box) ---');
  const accountName = await input({
    message: 'Account name:',
    default: existing.accountName ?? '',
  });
  const accountNumber = await input({
    message: 'Account number:',
    default: existing.accountNumber ?? '',
  });
  const ifsc = await input({ message: 'IFSC code:', default: existing.ifsc ?? '' });
  const accountType = await input({
    message: 'Account type (e.g. Savings / Current):',
    default: existing.accountType ?? '',
  });
  const bankName = await input({ message: 'Bank name:', default: existing.bankName ?? '' });
  return omitEmpty({
    accountName,
    accountNumber,
    ifsc,
    accountType,
    bankName,
  }) as Config['bank'];
}

export interface TaxSection {
  defaultTaxRate?: number;
  taxLabel?: string;
  paymentInstructions?: string;
}

export async function setupTax(existing: TaxSection = {}): Promise<TaxSection> {
  console.log('\n--- Tax & payment defaults ---');
  const rateRaw = await input({
    message: 'Default tax rate (decimal, e.g. 0.18 for 18%; empty to clear):',
    default: existing.defaultTaxRate !== undefined ? String(existing.defaultTaxRate) : '',
  });
  const parsedRate = rateRaw === '' ? undefined : Number(rateRaw);
  const defaultTaxRate = Number.isFinite(parsedRate) ? parsedRate : undefined;
  const taxLabel = await input({
    message: 'Tax label (e.g. GST, IGST, VAT):',
    default: existing.taxLabel ?? '',
  });
  const paymentInstructions = await readMultiline(
    'Payment instructions',
    existing.paymentInstructions,
  );
  return omitEmpty({ defaultTaxRate, taxLabel, paymentInstructions });
}

export async function setupMail(existing: Config['mail']): Promise<Config['mail']> {
  console.log('\n--- Mail (subject line, body template, reply-to) ---');
  console.log(
    '  Placeholders: {invoiceNumber}, {customerName}, {total}, {currency}, {issueDate}, {dueDate}',
  );
  const subjectTemplate = await input({
    message: 'Subject template (empty for default):',
    default: existing.subjectTemplate ?? '',
  });
  const replyTo = await input({
    message: 'Reply-to email (optional):',
    default: existing.replyTo ?? '',
  });
  const bodyTemplate = await readMultiline('Body template (optional)', existing.bodyTemplate);
  return {
    ...existing,
    ...omitEmpty({ subjectTemplate, replyTo, bodyTemplate }),
  };
}

export async function setupBranding(
  existing: Config['branding'] = {},
): Promise<Config['branding']> {
  console.log('\n--- Branding & signature ---');
  const primaryColor = await input({
    message: 'Primary color (hex, e.g. #3949ab):',
    default: existing.primaryColor ?? '',
  });
  const fontFamily = await input({
    message: 'Font family:',
    default: existing.fontFamily ?? '',
  });
  const signatureUrl = await input({
    message: 'Signature image path or URL (optional):',
    default: existing.signatureUrl ?? '',
  });
  const signatoryLabel = await input({
    message: 'Signatory label:',
    default: existing.signatoryLabel ?? 'Authorised Signatory',
  });
  return omitEmpty({
    primaryColor,
    fontFamily,
    signatureUrl,
    signatoryLabel,
  }) as Config['branding'];
}

export async function setupLineItemHeader(existing: string = 'Description'): Promise<string> {
  console.log('\n--- Line-item column header ---');
  const header = await input({
    message: 'Header text:',
    default: existing,
  });
  return header || 'Description';
}

/**
 * Number-format prompt. When `companyName` is set (and the existing format
 * doesn't already use a literal prefix), suggest `{COMPANY3}-{YYYY}-{SEQ}` so
 * the format adapts if the company name later changes.
 */
export async function setupNumberFormat(existing: string, companyName?: string): Promise<string> {
  const prefix = companyPrefix(companyName);
  const suggested = existing || (prefix ? '{COMPANY3}-{YYYY}-{SEQ}' : 'INV-{YYYY}-{SEQ}');
  return await input({
    message: 'Invoice number format (placeholders: {SEQ}, {YYYY}, {MM}, {DD}, {COMPANY3}):',
    default: suggested,
  });
}

// Suppress unused-import lint for `confirm` while keeping the import for future
// use (Phase 4.6 wires it into the optional-sections gates).
void confirm;
