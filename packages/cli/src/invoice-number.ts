import type { Config } from '@invoice/shared';

export interface NumberSpec {
  format: string;
  seq: number;
  /** Passed to `renderInvoiceNumber` as the source of `{COMPANY3}`. */
  companyName: string | undefined;
  /**
   * Set when the spec came from a customer record. Tells the caller which
   * counter to bump after the upsert succeeds (customer's `nextSeq` vs. the
   * global `config.invoice.nextSeq`).
   */
  customerSlug?: string;
}

/**
 * Pick the right invoice-number format + sequence counter.
 *
 * Customer-scoped path (`customer.numberFormat` is set):
 *   format    = customer.numberFormat
 *   seq       = customer.nextSeq
 *   {COMPANY3} resolves to first 3 chars of customer.name
 *
 * Global path (no slug, or the slug has no `numberFormat`):
 *   format    = config.invoice.numberFormat
 *   seq       = config.invoice.nextSeq
 *   {COMPANY3} resolves to first 3 chars of config.company.name (or blank).
 */
export function resolveNumberSpec(
  config: Config,
  customerSlug: string | undefined,
): NumberSpec {
  if (customerSlug) {
    const customer = config.customers[customerSlug];
    if (customer && customer.numberFormat && customer.numberFormat.length > 0) {
      return {
        format: customer.numberFormat,
        seq: customer.nextSeq,
        companyName: customer.name,
        customerSlug,
      };
    }
  }
  return {
    format: config.invoice.numberFormat,
    seq: config.invoice.nextSeq,
    companyName: config.company.name,
  };
}
