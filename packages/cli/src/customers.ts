import type { Config } from '@invoice/shared';

export type CustomerData = Config['customers'][string];

/**
 * Convert a customer's display name into a filesystem-safe slug used as the
 * map key in `config.customers`. Same pattern as templates: lowercase,
 * alphanumeric-only, hyphen-separated.
 *
 * "Acme Corp"      -> "acme-corp"
 * "Globex, Inc."   -> "globex-inc"
 * "  trailing  "   -> "trailing"
 */
export function slugFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** All customers sorted by display name. */
export function listCustomers(config: Config): Array<[string, CustomerData]> {
  return Object.entries(config.customers).sort(([, a], [, b]) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Look up a customer by slug or by display name (case-insensitive). Returns
 * null when neither matches.
 */
export function getCustomer(config: Config, ref: string): CustomerData | null {
  const direct = config.customers[ref];
  if (direct) return direct;
  const lower = ref.toLowerCase();
  for (const customer of Object.values(config.customers)) {
    if (customer.name.toLowerCase() === lower) return customer;
  }
  return null;
}

/** Like getCustomer but returns the matching slug instead of the data. */
export function findCustomerSlug(config: Config, ref: string): string | null {
  if (config.customers[ref]) return ref;
  const lower = ref.toLowerCase();
  for (const [slug, customer] of Object.entries(config.customers)) {
    if (customer.name.toLowerCase() === lower) return slug;
  }
  return null;
}

/**
 * Return a new config with the given customer record set. Caller is
 * responsible for calling `saveConfig(...)` on the result. Used by both
 * `invoice customer save` and the inline-save path in `invoice new`.
 */
export function setCustomer(config: Config, slug: string, data: CustomerData): Config {
  return {
    ...config,
    customers: {
      ...config.customers,
      [slug]: data,
    },
  };
}

/**
 * Return a new config with the given customer's `nextSeq` incremented by 1.
 * No-op if the slug doesn't exist (defensive — caller should have validated
 * the slug already). Used after a customer-scoped invoice number is consumed.
 */
export function bumpCustomerSeq(config: Config, slug: string): Config {
  const existing = config.customers[slug];
  if (!existing) return config;
  return {
    ...config,
    customers: {
      ...config.customers,
      [slug]: { ...existing, nextSeq: existing.nextSeq + 1 },
    },
  };
}

/**
 * Return a new config with the named customer removed. No-op if the slug
 * doesn't exist (so callers don't need to pre-check).
 */
export function deleteCustomer(config: Config, slug: string): Config {
  if (!(slug in config.customers)) return config;
  const next = { ...config.customers };
  delete next[slug];
  return { ...config, customers: next };
}

/** Whether a customer is reachable via slug-or-name (`getCustomer` would resolve it). */
export function customerExists(config: Config, ref: string): boolean {
  return getCustomer(config, ref) !== null;
}
