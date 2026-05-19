import type { Command } from 'commander';
import { ConfigSchema, type Config } from '@invoice/shared';
import { loadConfigSafe, saveConfig } from '../store.js';
import {
  setupBank,
  setupBranding,
  setupCompany,
  setupLineItemHeader,
  setupMail,
  setupNumberFormat,
  setupTax,
} from './init.js';

export function register(program: Command): void {
  const cmd = program
    .command('setup')
    .description(
      're-run a specific section of the init wizard (company / bank / tax / mail / branding / line-header / number-format / all)',
    );

  cmd.command('company').description('Set company info (Billed By section)').action(runCompany);
  cmd
    .command('bank')
    .description('Set bank details (Bank Details box on invoices)')
    .action(runBank);
  cmd
    .command('tax')
    .description('Set tax rate, tax label, and payment instructions')
    .action(runTax);
  cmd
    .command('mail')
    .description('Set email subject template, body template, and reply-to')
    .action(runMail);
  cmd
    .command('branding')
    .description('Set primary color, font family, signature, signatory label')
    .action(runBranding);
  cmd
    .command('line-header')
    .description('Set line-item column header (default "Description")')
    .action(runLineHeader);
  cmd
    .command('number-format')
    .description('Set invoice number format (placeholders: {SEQ}, {YYYY}, {MM}, {DD}, {COMPANY3})')
    .action(runNumberFormat);
  cmd
    .command('all')
    .description('Re-walk every optional section in one go')
    .action(runAll);
}

function requireConfig(): Config {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Run `invoice init` first to set up the basics.');
    process.exit(1);
  }
  return config;
}

function persist(config: Config, patch: Partial<Record<string, unknown>>): void {
  const merged: Record<string, unknown> = {
    ...(config as unknown as Record<string, unknown>),
    ...patch,
  };
  const next = ConfigSchema.parse(merged);
  saveConfig(next);
  console.log('Saved.');
}

async function runCompany(): Promise<void> {
  const config = requireConfig();
  const company = await setupCompany(config.company);
  persist(config, { company });
}

async function runBank(): Promise<void> {
  const config = requireConfig();
  const bank = await setupBank(config.bank);
  persist(config, { bank });
}

async function runTax(): Promise<void> {
  const config = requireConfig();
  const tax = await setupTax({
    defaultTaxRate: config.invoice.defaultTaxRate,
    taxLabel: config.invoice.taxLabel,
    paymentInstructions: config.invoice.paymentInstructions,
  });
  persist(config, { invoice: { ...config.invoice, ...tax } });
}

async function runMail(): Promise<void> {
  const config = requireConfig();
  const result = await setupMail(config.mail);
  // Recipients are managed by `invoice init` (or hand-edit). `setup mail` never
  // touches them — preserve from existing config regardless of what setupMail
  // returned.
  const mail = { ...result, recipients: config.mail.recipients };
  persist(config, { mail });
}

async function runBranding(): Promise<void> {
  const config = requireConfig();
  const branding = await setupBranding(config.branding);
  persist(config, { branding });
}

async function runLineHeader(): Promise<void> {
  const config = requireConfig();
  const lineItemHeader = await setupLineItemHeader(config.invoice.lineItemHeader);
  persist(config, { invoice: { ...config.invoice, lineItemHeader } });
}

async function runNumberFormat(): Promise<void> {
  const config = requireConfig();
  const numberFormat = await setupNumberFormat(config.invoice.numberFormat, config.company.name);
  persist(config, { invoice: { ...config.invoice, numberFormat } });
}

async function runAll(): Promise<void> {
  // Verify config exists once up-front so we don't half-walk the wizard.
  requireConfig();
  await runCompany();
  await runNumberFormat();
  await runBank();
  await runTax();
  await runMail();
  await runBranding();
  await runLineHeader();
}
