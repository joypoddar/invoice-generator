import type { Config, Invoice } from '@invoice/shared';
import { getCustomer } from './customers.js';
import type { Recipients } from './email.js';

export interface RecipientOverrides {
  to?: string[];
  cc?: string[];
  bcc?: string[];
}

/**
 * Compose the effective recipients for a send.
 *
 * Precedence per field: CLI override (--to/--cc/--bcc) > customer default > global default.
 * Customers don't carry a bcc list, so bcc only ever resolves from override or global.
 * A slug that no longer resolves (customer was deleted) silently falls back to the global default.
 */
export function composeRecipients(
  config: Config,
  invoice: Invoice,
  overrides: RecipientOverrides = {},
): Recipients {
  const slug =
    typeof invoice.default.customerSlug === 'string'
      ? invoice.default.customerSlug
      : undefined;
  const customer = slug ? getCustomer(config, slug) : null;

  const customerTo = customer?.defaultRecipientTo ?? [];
  const customerCc = customer?.defaultRecipientCc ?? [];

  const defaultTo = customerTo.length > 0 ? customerTo : config.mail.recipients.to;
  const defaultCc = customerCc.length > 0 ? customerCc : config.mail.recipients.cc;
  const defaultBcc = config.mail.recipients.bcc;

  return {
    to: overrides.to ?? defaultTo,
    cc: overrides.cc ?? defaultCc,
    bcc: overrides.bcc ?? defaultBcc,
  };
}
