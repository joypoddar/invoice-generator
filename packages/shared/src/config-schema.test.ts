import { describe, expect, it } from 'vitest';
import { ConfigSchema } from './config-schema.js';

const validPhase1Config = {
  name: 'Joy Poddar',
  email: 'joy@creowis.com',
  smtp: { host: 'smtp.gmail.com', port: 465, user: 'joy@creowis.com' },
  imap: { host: 'imap.gmail.com', port: 993, user: 'joy@creowis.com', folder: '[Gmail]/Sent Mail' },
  mail: {
    recipients: { to: ['hello@creowis.com'] },
  },
};

describe('ConfigSchema', () => {
  it('parses a valid Phase-1 config', () => {
    const result = ConfigSchema.safeParse(validPhase1Config);
    expect(result.success).toBe(true);
  });

  it('applies defaults for deferred-phase keys', () => {
    const parsed = ConfigSchema.parse(validPhase1Config);
    expect(parsed.currency).toBe('USD');
    expect(parsed.invoice.numberFormat).toBe('INV-{YYYY}-{SEQ}');
    expect(parsed.invoice.nextSeq).toBe(1);
    expect(parsed.invoice.defaultDueDays).toBe(30);
    expect(parsed.storage.backend).toBe('sqlite');
    expect(parsed.cli.confirmBeforeSend).toBe(true);
    expect(parsed.dashboard.host).toBe('127.0.0.1');
    expect(parsed.dashboard.port).toBe(3000);
    expect(parsed.llm.provider).toBe('disabled');
    expect(parsed.git.enabled).toBe(false);
    expect(parsed.mail.recipients.cc).toEqual([]);
    expect(parsed.mail.recipients.bcc).toEqual([]);
  });

  it('fails on missing essential keys', () => {
    const partial: Record<string, unknown> = { ...validPhase1Config };
    delete partial.name;
    expect(ConfigSchema.safeParse(partial).success).toBe(false);
  });

  it('fails on invalid email format in recipients', () => {
    const bad = { ...validPhase1Config, mail: { recipients: { to: ['not-an-email'] } } };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('fails when smtp.port is not a positive integer', () => {
    const bad = { ...validPhase1Config, smtp: { ...validPhase1Config.smtp, port: -1 } };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('fails when mail.recipients.to is empty', () => {
    const bad = {
      ...validPhase1Config,
      mail: { recipients: { to: [] } },
    };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('fails when imap.folder is empty', () => {
    const bad = { ...validPhase1Config, imap: { ...validPhase1Config.imap, folder: '' } };
    expect(ConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts user overrides for defaulted keys', () => {
    const custom = {
      ...validPhase1Config,
      currency: 'INR',
      invoice: { numberFormat: 'CREOWIS-{YYYY}-{SEQ}', nextSeq: 42 },
    };
    const parsed = ConfigSchema.parse(custom);
    expect(parsed.currency).toBe('INR');
    expect(parsed.invoice.numberFormat).toBe('CREOWIS-{YYYY}-{SEQ}');
    expect(parsed.invoice.nextSeq).toBe(42);
  });
});
