import type { Command } from 'commander';
import { connect, ingest, SqliteStore } from '@invoice/core';
import { dbPath, loadConfigSafe } from '../store.js';
import { getPassword, IMAP_PASSWORD_ACCOUNT } from '../secrets.js';

interface SyncOptions {
  backfill?: boolean;
  since?: string;
}

export function register(program: Command): void {
  program
    .command('sync')
    .description('Pull new invoices from the configured IMAP folder into the local DB')
    .option('--backfill', 'ignore the watermark and fetch every matching message')
    .option('--since <date>', 'fetch messages from a specific date (Phase 2)')
    .action(runSync);
}

async function runSync(opts: SyncOptions): Promise<void> {
  const config = loadConfigSafe();
  if (!config) {
    console.error('Not configured. Run `invoice init` first.');
    process.exit(1);
  }

  if (opts.since) {
    console.error('`--since` is not implemented in Phase 1.');
    process.exit(1);
  }

  const password = getPassword(IMAP_PASSWORD_ACCOUNT);
  if (!password) {
    console.error('IMAP password not in keychain. Run `invoice init` to set it.');
    process.exit(1);
  }

  const store = new SqliteStore(dbPath());
  try {
    const lastUid = opts.backfill ? 0 : store.getLastUid();
    console.log(
      `Syncing from "${config.imap.folder}" (${opts.backfill ? 'backfill' : `since uid ${lastUid}`})…`,
    );

    const client = await connect(
      { host: config.imap.host, port: config.imap.port, user: config.imap.user },
      password,
    );
    try {
      const result = await ingest(store, client, config.imap.folder, lastUid);
      if (result.newLastUid > store.getLastUid()) {
        store.setLastUid(result.newLastUid);
      }
      console.log(`Synced ${result.syncedCount} new invoice(s). Watermark: uid ${result.newLastUid}.`);
    } finally {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
    }
  } finally {
    store.close();
  }
}
