import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema, type Config } from '@invoice/shared';

/**
 * Resolves the data directory each call so tests (and the verification
 * script) can override via INVOICE_HOME after process start.
 */
export function invoiceDir(): string {
  return process.env.INVOICE_HOME ?? join(homedir(), '.invoice');
}

export function configPath(): string {
  return join(invoiceDir(), 'config.json');
}

export function dbPath(): string {
  return join(invoiceDir(), 'local.db');
}

export function ensureInvoiceDir(): void {
  const dir = invoiceDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    chmodSync(dir, 0o700);
  }
}

export function configExists(): boolean {
  return existsSync(configPath());
}

export function loadConfig(): Config {
  const raw = readFileSync(configPath(), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return ConfigSchema.parse(parsed);
}

export function loadConfigSafe(): Config | null {
  if (!configExists()) return null;
  return loadConfig();
}

export function saveConfig(config: Config): void {
  ensureInvoiceDir();
  const validated = ConfigSchema.parse(config);
  writeFileSync(configPath(), JSON.stringify(validated, null, 2), { mode: 0o600 });
  chmodSync(configPath(), 0o600);
}
