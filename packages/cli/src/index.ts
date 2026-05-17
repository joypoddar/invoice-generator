#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program.name('invoice').description('Invoice generator').version('0.0.0');

const notYet = (name: string) => () => {
  console.error(`'invoice ${name}' is not yet implemented.`);
  process.exit(1);
};

program
  .command('init')
  .description('Interactive setup: SMTP/IMAP creds, folder picker, defaults')
  .action(notYet('init'));

program
  .command('config <action> [args...]')
  .description('get | set | unset | edit | validate | doctor')
  .action(notYet('config'));

program
  .command('whoami')
  .description('Show configured identity and folder scope')
  .action(notYet('whoami'));

program
  .command('new')
  .description('Create a new invoice (interactive)')
  .action(notYet('new'));

program
  .command('list')
  .description('List invoices from the local database')
  .action(notYet('list'));

program
  .command('send <id>')
  .description('Render and email an invoice (confirms recipients first; --yes to skip)')
  .option('--to <email...>', 'override recipients (replaces config)')
  .option('--cc <email...>', 'override cc recipients')
  .option('--bcc <email...>', 'override bcc recipients')
  .option('-y, --yes', 'skip the confirmation prompt')
  .action(notYet('send'));

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
