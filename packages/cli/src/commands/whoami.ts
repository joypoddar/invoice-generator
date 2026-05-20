import type { Command } from 'commander';
import { loadConfigSafe } from '../store.js';
import { getPassword, IMAP_PASSWORD_ACCOUNT, SMTP_PASSWORD_ACCOUNT } from '../secrets.js';

export function register(program: Command): void {
  program
    .command('whoami')
    .description('Show configured identity and folder scope')
    .action(runWhoami);
}

function runWhoami(): void {
  const config = loadConfigSafe();
  if (!config) {
    console.log('Not configured. Run `invoice init`.');
    process.exit(1);
  }
  const imapOk = getPassword(IMAP_PASSWORD_ACCOUNT) !== null;
  console.log(`Name:       ${config.name}`);
  console.log(`Email:      ${config.email}`);
  console.log(`Currency:   ${config.currency}`);
  console.log(`Folder:     ${config.imap.folder}`);
  console.log(`IMAP user:  ${config.imap.user} ${imapOk ? '(password in keychain)' : '(MISSING password)'}`);
  if (config.smtp) {
    const smtpOk = getPassword(SMTP_PASSWORD_ACCOUNT) !== null;
    console.log(
      `SMTP user:  ${config.smtp.user} ${smtpOk ? '(password in keychain)' : '(MISSING password)'}`,
    );
  } else {
    console.log(`SMTP:       not configured (receive-only install)`);
  }
  if (config.mail) {
    console.log(`Recipients: ${config.mail.recipients.to.join(', ')}`);
  } else {
    console.log(`Recipients: not configured (receive-only install)`);
  }
}
