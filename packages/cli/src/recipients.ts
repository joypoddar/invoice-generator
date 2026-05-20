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

  // `config.mail` is optional (a receive-only install never sets it). When
  // absent, only overrides + customer defaults can populate recipients;
  // `performSend` is responsible for refusing to send when `to` ends up empty.
  const globalTo = config.mail?.recipients.to ?? [];
  const globalCc = config.mail?.recipients.cc ?? [];
  const globalBcc = config.mail?.recipients.bcc ?? [];

  const defaultTo = customerTo.length > 0 ? customerTo : globalTo;
  const defaultCc = customerCc.length > 0 ? customerCc : globalCc;
  const defaultBcc = globalBcc;

  return {
    to: overrides.to ?? defaultTo,
    cc: overrides.cc ?? defaultCc,
    bcc: overrides.bcc ?? defaultBcc,
  };
}
