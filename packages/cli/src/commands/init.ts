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

// Suppress unused-import lint for `confirm` while keeping the import for future
// use (e.g. "overwrite existing config?"). Phase 1 doesn't ask, so reference it.
void confirm;
