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
import { clearDraft, draftExists, loadDraft, saveDraft } from '../drafts.js';
import { slugFor, type CustomerData } from '../customers.js';
import { validateEmail, validateEmailList, validateIfsc } from '../validators.js';

interface InitDraft {
  name?: string;
  email?: string;
  currency?: string;
  /**
   * Whether this install will send invoices (SMTP). When false the SMTP block,
   * default-recipients prompt, number-format prompt, and the mail
   * subject/body/reply-to optional section are all skipped. Receive-only
   * installs (account head / inbox manager) answer false here.
   */
  wantsSending?: boolean;
  numberFormat?: string;
  company?: Config['company'];
  smtp?: { host: string; port: number; user: string };
  imap?: { host: string; port: number; user: string; folder: string };
  recipientsTo?: string[];
  bank?: Config['bank'];
  tax?: TaxSection;
  mailExtras?: Partial<NonNullable<Config['mail']>>;
  branding?: Config['branding'];
  lineItemHeader?: string;
  customers?: Config['customers'];
}

function printWelcome(): void {
  console.log(`
Invoice generator — Creowis CLI
───────────────────────────────────────────
This tool lets you:
  • Create invoices         (invoice new)
  • Send them via SMTP      (invoice send <id>)
  • Pull received invoices  (invoice sync)
  • Mark paid / overdue     (invoice mark <id> paid)
  • Clone last month's      (invoice clone <id>)

Setup is one-time. Each section can be re-run later via
  invoice setup <section>

Press Ctrl+C at any time — your progress is saved.
───────────────────────────────────────────
`);
}

export function register(program: Command): void {
  program
    .command('init')
    .description('Interactive setup: identity, SMTP, IMAP (with folder picker), defaults')
    .action(runInit);
}

async function runInit(): Promise<void> {
  printWelcome();
  const existing = loadConfigSafe();
  if (existing) console.log('Existing config found — press Enter to keep current values.\n');

  // Draft persistence: if a previous init session was interrupted, offer to resume.
  let draft: InitDraft = {};
  if (draftExists('init')) {
    const resume = await confirm({
      message: 'Resume previous init session? (Your typed values will pre-fill the prompts.)',
      default: true,
    });
    if (resume) {
      draft = loadDraft<InitDraft>('init') ?? {};
    } else {
      clearDraft('init');
    }
  }
  const persist = (patch: Partial<InitDraft>): void => {
    draft = { ...draft, ...patch };
    saveDraft('init', draft);
  };

  // 1. Identity
  const name = await input({
    message: 'Your name:',
    default: draft.name ?? existing?.name,
    required: true,
  });
  const email = await input({
    message: 'Your email:',
    default: draft.email ?? existing?.email,
    required: true,
    validate: validateEmail(false),
  });
  const currency = await input({
    message: 'Default currency (3-letter ISO code):',
    default: draft.currency ?? existing?.currency ?? 'INR',
  });
  persist({ name, email, currency });

  // 2. Company info (optional). Captures company.name early so the number
  // format prompt below can suggest {COMPANY3}-... when set.
  let companySection: Config['company'] | undefined = draft.company ?? existing?.company;
  const wantsCompany = await confirm({
    message: 'Set up company info now? (used in the Billed By section)',
    default: !draft.company?.name && !existing?.company?.name,
  });
  if (wantsCompany) {
    companySection = await setupCompany(draft.company ?? existing?.company);
    persist({ company: companySection });
  }

  // 3. Sending capability gate. Receive-only installs (account head / inbox
  // manager) skip SMTP, default recipients, and number format below. The
  // choice is persisted to the draft so a mid-flow Ctrl+C resumes correctly.
  const wantsSending = await confirm({
    message:
      'Set up sending (SMTP)? Skip this if you only need to read invoices (account head / inbox manager).',
    default:
      draft.wantsSending ??
      (existing?.smtp !== undefined || (!draft && !existing)),
  });
  persist({ wantsSending });

  // 4. Invoice number format (only relevant when this install will send).
  let numberFormat: string | undefined = draft.numberFormat ?? existing?.invoice.numberFormat;
  if (wantsSending) {
    numberFormat = await setupNumberFormat(
      draft.numberFormat ?? existing?.invoice.numberFormat ?? '',
      companySection?.name,
    );
    persist({ numberFormat });
  }

  // 5. SMTP — loop until verify succeeds or user gives up. Skipped entirely
  // for receive-only installs; no keychain entry is written.
  let smtp: { host: string; port: number; user: string; password: string } | undefined;
  let smtpPass: string | undefined;
  if (wantsSending) {
    console.log('\n--- SMTP (sending) ---');
    smtp = await collectSmtp({
      draft: draft.smtp,
      existing: existing?.smtp,
      defaultUser: email,
    });
    persist({ smtp: { host: smtp.host, port: smtp.port, user: smtp.user } });
    smtpPass = smtp.password;
  }

  // 6. IMAP — loop until connect succeeds or user gives up. Always required:
  // sync is what populates the local DB, even for receive-only installs.
  console.log('\n--- IMAP (sync) ---');
  const imapResult = await collectImap({
    draft: draft.imap,
    existing: existing?.imap,
    defaultUser: smtp?.user ?? email,
  });
  const imapPass = imapResult.password;
  const client = imapResult.client;
  let folder: string;
  try {
    const folders = await listFolders(client);
    const ranked = [...folders].sort(
      (a, b) => specialRank(a.specialUse) - specialRank(b.specialUse),
    );
    console.log(
      '  Tip: your own Sent folder = see invoices you sent. ' +
        'INBOX of a shared mailbox (e.g., hello@creowis.com) = see invoices the team received.',
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
  persist({ imap: { ...imapResult.connection, folder } });

  // 7. Default recipients (only when this install will send).
  let toList: string[] = draft.recipientsTo ?? existing?.mail?.recipients.to ?? [];
  if (wantsSending) {
    console.log('\n--- Default recipients ---');
    const toCsv = await input({
      message: "Default 'to' (comma-separated email addresses):",
      default:
        draft.recipientsTo?.join(', ') ??
        existing?.mail?.recipients.to.join(', ') ??
        'hello@creowis.com',
      validate: validateEmailList(false),
    });
    toList = toCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    persist({ recipientsTo: toList });
  }

  // 7. Optional sections — each gated on (y/N). Defaults to "yes" when no
  // value exists, "no" otherwise so re-running init doesn't make you re-walk
  // already-set sections.
  console.log(
    '\n--- Optional setup (skippable — you can run any of these later via `invoice setup <section>`) ---',
  );

  let bankSection: Config['bank'] | undefined = draft.bank ?? existing?.bank;
  if (
    await confirm({
      message: 'Set up bank details now?',
      default: !draft.bank?.accountNumber && !existing?.bank?.accountNumber,
    })
  ) {
    bankSection = await setupBank(draft.bank ?? existing?.bank);
    persist({ bank: bankSection });
  }

  let taxSection: TaxSection | undefined = draft.tax;
  if (
    await confirm({
      message: 'Set up tax & payment defaults now?',
      default:
        draft.tax === undefined &&
        existing?.invoice.defaultTaxRate === undefined,
    })
  ) {
    taxSection = await setupTax({
      defaultTaxRate: draft.tax?.defaultTaxRate ?? existing?.invoice.defaultTaxRate,
      taxLabel: draft.tax?.taxLabel ?? existing?.invoice.taxLabel,
      paymentInstructions:
        draft.tax?.paymentInstructions ?? existing?.invoice.paymentInstructions,
    });
    persist({ tax: taxSection });
  }

  let mailExtras: Partial<NonNullable<Config['mail']>> | undefined = draft.mailExtras;
  if (
    wantsSending &&
    (await confirm({
      message: 'Set up mail (subject template, body template, reply-to) now?',
      default: !draft.mailExtras?.subjectTemplate && !existing?.mail?.subjectTemplate,
    }))
  ) {
    const result = await setupMail({
      ...(existing?.mail ?? { recipients: { to: toList, cc: [], bcc: [] } }),
      ...(draft.mailExtras ?? {}),
    });
    const { recipients: _recipients, ...rest } = result;
    mailExtras = rest;
    persist({ mailExtras });
  }

  let brandingSection: Config['branding'] | undefined =
    draft.branding ?? existing?.branding;
  if (
    await confirm({
      message: 'Set up branding & signature now?',
      default: !draft.branding?.primaryColor && !existing?.branding?.primaryColor,
    })
  ) {
    brandingSection = await setupBranding(draft.branding ?? existing?.branding);
    persist({ branding: brandingSection });
  }

  let lineItemHeader: string | undefined = draft.lineItemHeader;
  if (
    await confirm({
      message: 'Set the line-item column header? (default "Description")',
      default: false,
    })
  ) {
    lineItemHeader = await setupLineItemHeader(
      draft.lineItemHeader ?? existing?.invoice.lineItemHeader,
    );
    persist({ lineItemHeader });
  }

  // Customer directory — optional, lets `invoice new` show a picker later.
  let customersSection: Config['customers'] | undefined =
    draft.customers ?? existing?.customers;
  const hasExisting = Object.keys(customersSection ?? {}).length > 0;
  if (
    await confirm({
      message: 'Add customers now? (you can also add them later via `invoice customer save`)',
      default: !hasExisting,
    })
  ) {
    customersSection = { ...(customersSection ?? {}) };
    let adding = true;
    while (adding) {
      const customer = await setupCustomer();
      customersSection[slugFor(customer.name)] = customer;
      persist({ customers: customersSection });
      console.log(`  Saved "${customer.name}".`);
      adding = await confirm({ message: 'Add another customer?', default: false });
    }
  }

  // Merge everything into a fresh config object and validate. Receive-only
  // installs persist neither `smtp` nor `mail`; the schema allows both to be
  // absent and send-path commands check for them at runtime.
  const merged: Record<string, unknown> = {
    ...(existing as unknown as Record<string, unknown> | undefined),
    name,
    email,
    currency,
    imap: { ...imapResult.connection, folder },
    company: companySection ?? existing?.company ?? {},
    bank: bankSection ?? existing?.bank ?? {},
    branding: brandingSection ?? existing?.branding ?? {},
    customers: customersSection ?? existing?.customers ?? {},
    invoice: {
      ...(existing?.invoice ?? {}),
      ...(numberFormat !== undefined ? { numberFormat } : {}),
      ...(taxSection ?? {}),
      ...(lineItemHeader !== undefined ? { lineItemHeader } : {}),
    },
  };
  if (wantsSending && smtp) {
    merged.smtp = { host: smtp.host, port: smtp.port, user: smtp.user };
    merged.mail = {
      ...(existing?.mail ?? {}),
      ...(mailExtras ?? {}),
      recipients: { ...(existing?.mail?.recipients ?? {}), to: toList },
    };
  } else {
    // Strip any leftover send-side fields if this is a re-init that flipped
    // an existing sending install to receive-only.
    delete merged.smtp;
    delete merged.mail;
  }
  const config = ConfigSchema.parse(merged);

  saveConfig(config);
  if (wantsSending && smtpPass) setPassword(SMTP_PASSWORD_ACCOUNT, smtpPass);
  setPassword(IMAP_PASSWORD_ACCOUNT, imapPass);

  ensureInvoiceDir();
  const store = new SqliteStore(dbPath());
  store.close();

  clearDraft('init');

  if (wantsSending) {
    console.log('\nSetup complete. Try `invoice whoami`.');
  } else {
    console.log(
      '\nSetup complete (receive-only). Run `invoice setup smtp` later if you want to start sending.',
    );
  }
}

function specialRank(use?: string): number {
  if (use === '\\Sent') return 0;
  if (use === '\\Inbox') return 1;
  return 9;
}

/**
 * Collect SMTP host/port/user/password and verify the connection. Loops on
 * verify failure with a "retry?" prompt so a single typo doesn't tear down
 * the whole init session.
 */
export async function collectSmtp(args: {
  draft?: { host: string; port: number; user: string };
  existing?: { host: string; port: number; user: string };
  defaultUser: string;
}): Promise<{ host: string; port: number; user: string; password: string }> {
  let host = args.draft?.host ?? args.existing?.host ?? 'smtp.gmail.com';
  let port = args.draft?.port ?? args.existing?.port ?? 465;
  let user = args.draft?.user ?? args.existing?.user ?? args.defaultUser;

  while (true) {
    host = await input({ message: 'SMTP host:', default: host });
    port = Number(await input({ message: 'SMTP port:', default: String(port) }));
    user = await input({ message: 'SMTP username:', default: user });
    const existingPass = getPassword(SMTP_PASSWORD_ACCOUNT);
    const passInput = await passwordPrompt({
      message: `SMTP app password${existingPass ? ' (press Enter to keep current)' : ''}:`,
      mask: '*',
    });
    const password = passInput || existingPass;
    if (!password) {
      console.error('SMTP password is required.');
      continue;
    }

    console.log('Testing SMTP…');
    const transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
    });
    try {
      await transporter.verify();
      console.log('SMTP OK.');
      return { host, port, user, password };
    } catch (err) {
      console.error(`SMTP failed: ${err instanceof Error ? err.message : String(err)}`);
      const retry = await confirm({
        message: 'Retry with different credentials?',
        default: true,
      });
      if (!retry) throw err;
    } finally {
      transporter.close();
    }
  }
}

/**
 * Collect IMAP host/port/user/password and open a session. Loops on connect
 * failure. Caller receives the connected client so it can fetch folders and
 * close cleanly.
 */
async function collectImap(args: {
  draft?: { host: string; port: number; user: string };
  existing?: { host: string; port: number; user: string };
  defaultUser: string;
}): Promise<{
  connection: { host: string; port: number; user: string };
  password: string;
  client: Awaited<ReturnType<typeof connect>>;
}> {
  let host = args.draft?.host ?? args.existing?.host ?? 'imap.gmail.com';
  let port = args.draft?.port ?? args.existing?.port ?? 993;
  let user = args.draft?.user ?? args.existing?.user ?? args.defaultUser;

  while (true) {
    host = await input({ message: 'IMAP host:', default: host });
    port = Number(await input({ message: 'IMAP port:', default: String(port) }));
    user = await input({ message: 'IMAP username:', default: user });
    const existingPass = getPassword(IMAP_PASSWORD_ACCOUNT);
    const passInput = await passwordPrompt({
      message: `IMAP app password${existingPass ? ' (press Enter to keep current)' : ''}:`,
      mask: '*',
    });
    const password = passInput || existingPass;
    if (!password) {
      console.error('IMAP password is required.');
      continue;
    }

    console.log('Testing IMAP and listing folders…');
    try {
      const client = await connect({ host, port, user }, password);
      return { connection: { host, port, user }, password, client };
    } catch (err) {
      console.error(`IMAP failed: ${err instanceof Error ? err.message : String(err)}`);
      const retry = await confirm({
        message: 'Retry with different credentials?',
        default: true,
      });
      if (!retry) throw err;
    }
  }
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
  const ifscRaw = await input({
    message: 'IFSC code:',
    default: existing.ifsc ?? '',
    validate: validateIfsc(true),
  });
  const ifsc = ifscRaw.toUpperCase();
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

export async function setupMail(
  existing: NonNullable<Config['mail']>,
): Promise<NonNullable<Config['mail']>> {
  console.log('\n--- Mail (subject line, body template, reply-to) ---');
  console.log(
    '  Placeholders: {invoiceNumber} {customerName} {customerEmail} {total} {currency}',
  );
  console.log(
    '                {issueDate} {dueDate} {userName} {userEmail} {companyName}',
  );
  console.log(
    '                {month} {monthShort} {monthNum} {year} {yearShort} {day} {dayPadded}',
  );
  const subjectTemplate = await input({
    message: 'Subject template (empty for default):',
    default: existing.subjectTemplate ?? '',
  });
  const replyTo = await input({
    message: 'Reply-to email (optional):',
    default: existing.replyTo ?? '',
    validate: validateEmail(true),
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

export async function setupCustomer(prefill?: Partial<CustomerData>): Promise<CustomerData> {
  console.log('\n--- Customer ---');
  const name = await input({
    message: 'Customer name:',
    default: prefill?.name ?? '',
    required: true,
  });
  const email = await input({
    message: 'Email (optional):',
    default: prefill?.email ?? '',
    validate: validateEmail(true),
  });
  const address = await readMultiline('Address (optional)', prefill?.address);
  const phone = await input({ message: 'Phone (optional):', default: prefill?.phone ?? '' });

  const toCsv = await input({
    message: "Default 'to' recipients (comma-separated emails):",
    default: prefill?.defaultRecipientTo?.join(', ') ?? '',
    validate: validateEmailList(true),
  });
  const defaultRecipientTo = toCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const ccCsv = await input({
    message: "Default 'cc' recipients (comma-separated emails, optional):",
    default: prefill?.defaultRecipientCc?.join(', ') ?? '',
    validate: validateEmailList(true),
  });
  const defaultRecipientCc = ccCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Per-customer invoice numbering (optional). When set, this customer's
  // invoices use this format + counter instead of the global one. Inside
  // a customer's format, `{COMPANY3}` resolves to the *customer's* name
  // initials, not the sender's.
  let numberFormat: string | undefined = prefill?.numberFormat;
  let nextSeq: number = prefill?.nextSeq ?? 1;
  const customizeNumber = await confirm({
    message: 'Customize invoice number format for this customer?',
    default: !!prefill?.numberFormat,
  });
  if (customizeNumber) {
    console.log(
      "  Placeholders: {SEQ} {YYYY} {MM} {DD} {COMPANY3}  (here {COMPANY3} = this customer's initials)",
    );
    const fmt = await input({
      message: 'Number format:',
      default: prefill?.numberFormat ?? '{COMPANY3}-{YYYY}-{SEQ}',
    });
    numberFormat = fmt.trim() || undefined;
    if (numberFormat) {
      const seqStr = await input({
        message: 'Starting sequence:',
        default: String(prefill?.nextSeq ?? 1),
        validate: (v: string) => {
          const n = Number(v);
          return Number.isInteger(n) && n >= 1 ? true : 'Enter a positive integer';
        },
      });
      nextSeq = Number(seqStr);
    }
  }

  const customer: CustomerData = {
    name,
    defaultRecipientTo,
    defaultRecipientCc,
    nextSeq,
  };
  if (email) customer.email = email;
  if (address) customer.address = address;
  if (phone) customer.phone = phone;
  if (numberFormat) customer.numberFormat = numberFormat;
  return customer;
}

export async function setupRecipients(existing?: string[]): Promise<string[]> {
  console.log('\n--- Default recipients ---');
  const toCsv = await input({
    message: "Default 'to' (comma-separated email addresses):",
    default: existing?.join(', ') ?? 'hello@creowis.com',
    validate: validateEmailList(false),
  });
  return toCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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

