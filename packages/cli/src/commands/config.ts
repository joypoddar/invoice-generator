import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { ConfigSchema } from '@invoice/shared';
import {
  configExists,
  configPath,
  loadConfig,
  loadConfigSafe,
  saveConfig,
} from '../store.js';
import { getPassword, IMAP_PASSWORD_ACCOUNT, SMTP_PASSWORD_ACCOUNT } from '../secrets.js';

export function register(program: Command): void {
  const cmd = program.command('config').description('Get / set / edit / validate configuration');

  cmd
    .command('get [key]')
    .description('Print the entire config, or a single key (dotted path: smtp.host)')
    .action(runGet);

  cmd.command('set <key> <value>').description('Set a config key (dotted path)').action(runSet);

  cmd.command('unset <key>').description('Remove a config key (falls back to default)').action(runUnset);

  cmd
    .command('edit')
    .description('Open the config file in $EDITOR; re-validates on save')
    .action(runEdit);

  cmd
    .command('validate')
    .description('Validate the current config against the schema')
    .action(runValidate);

  cmd
    .command('doctor')
    .description('Check that every required key is set and both keychain entries exist')
    .action(runDoctor);
}

function runGet(key?: string): void {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Config not found. Run `invoice init`.');
    process.exit(1);
  }
  if (!key) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  const value = getByPath(config, key);
  if (value === undefined) {
    console.error(`Key not found: ${key}`);
    process.exit(1);
  }
  console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
}

function runSet(key: string, value: string): void {
  const config = loadConfigSafe() ?? {};
  const coerced = coerce(value);
  const next = setByPath(config as Record<string, unknown>, key, coerced);
  try {
    const validated = ConfigSchema.parse(next);
    saveConfig(validated);
    console.log(`Set ${key} = ${JSON.stringify(coerced)}`);
  } catch (err) {
    console.error('Validation failed after applying the change:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function runUnset(key: string): void {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Config not found.');
    process.exit(1);
  }
  const next = config as unknown as Record<string, unknown>;
  unsetByPath(next, key);
  try {
    const validated = ConfigSchema.parse(next);
    saveConfig(validated);
    console.log(`Unset ${key}`);
  } catch (err) {
    console.error('Validation failed after unsetting (likely a required key):');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function runEdit(): Promise<void> {
  if (!configExists()) {
    console.error('Config does not exist. Run `invoice init` first.');
    process.exit(1);
  }
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';
  const child = spawn(editor, [configPath()], { stdio: 'inherit' });
  const code = await new Promise<number>((resolve, reject) => {
    child.on('exit', (c) => resolve(c ?? 1));
    child.on('error', reject);
  });
  if (code !== 0) {
    console.error(`Editor exited with code ${code}.`);
    process.exit(code);
  }
  try {
    loadConfig();
    console.log('Config saved and validated.');
  } catch (err) {
    console.error('Config is INVALID after editing:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function runValidate(): void {
  if (!configExists()) {
    console.error('Config does not exist.');
    process.exit(1);
  }
  try {
    loadConfig();
    console.log('Config is valid.');
  } catch (err) {
    console.error('Config is invalid:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function runDoctor(): void {
  let problems = 0;
  const config = loadConfigSafe();
  if (!config) {
    console.error('FAIL: config not found. Run `invoice init`.');
    process.exit(1);
  }
  console.log('Config: valid.');

  if (getPassword(SMTP_PASSWORD_ACCOUNT)) {
    console.log(`Keychain: smtp-app-password present (${config.smtp.user}).`);
  } else {
    console.error('FAIL: smtp-app-password missing from keychain.');
    problems++;
  }

  if (getPassword(IMAP_PASSWORD_ACCOUNT)) {
    console.log(`Keychain: imap-app-password present (${config.imap.user}).`);
  } else {
    console.error('FAIL: imap-app-password missing from keychain.');
    problems++;
  }

  if (problems === 0) console.log('\nAll good.');
  else process.exit(1);
}

// --- helpers ---

function coerce(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i] as string;
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1] as string] = value;
  return obj;
}

function unsetByPath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i] as string];
    if (!next || typeof next !== 'object') return;
    cur = next as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1] as string];
}
