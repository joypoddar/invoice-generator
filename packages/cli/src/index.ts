#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { Command } from 'commander';
import * as init from './commands/init.js';
import * as whoami from './commands/whoami.js';
import * as configCmd from './commands/config.js';
import * as newCmd from './commands/new.js';
import * as listCmd from './commands/list.js';
import * as sendCmd from './commands/send.js';

const program = new Command();

program.name('invoice').description('Invoice generator').version('0.0.0');

init.register(program);
configCmd.register(program);
whoami.register(program);
newCmd.register(program);
listCmd.register(program);
sendCmd.register(program);

const notYet = (name: string) => () => {
  console.error(`'invoice ${name}' is not yet implemented.`);
  process.exit(1);
};

program
  .command('sync')
  .description('Pull new invoices from the configured IMAP folder into the local DB')
  .option('--backfill', 'ignore the watermark and fetch everything')
  .option('--since <date>', 'fetch messages from a specific date (ISO)')
  .action(notYet('sync'));

program
  .command('mark <id> <status>')
  .description('Mark an invoice paid|unpaid')
  .action(notYet('mark'));

await program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
