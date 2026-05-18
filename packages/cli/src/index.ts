#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { Command } from 'commander';
import * as init from './commands/init.js';
import * as whoami from './commands/whoami.js';
import * as configCmd from './commands/config.js';
import * as newCmd from './commands/new.js';
import * as listCmd from './commands/list.js';
import * as sendCmd from './commands/send.js';
import * as syncCmd from './commands/sync.js';
import * as markCmd from './commands/mark.js';
import * as cloneCmd from './commands/clone.js';

const program = new Command();

program.name('invoice').description('Invoice generator').version('0.0.0');

init.register(program);
configCmd.register(program);
whoami.register(program);
newCmd.register(program);
listCmd.register(program);
sendCmd.register(program);
syncCmd.register(program);
markCmd.register(program);
cloneCmd.register(program);

await program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
