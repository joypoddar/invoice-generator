import type { Invoice } from '@invoice/shared';
import type { InvoiceStore } from '@invoice/core';

export type ResolveResult =
  | { ok: true; invoice: Invoice }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'ambiguous'; matches: Invoice[] };

/** Minimum length for a UUID prefix to be considered valid (avoids "1" matching everything). */
const MIN_PREFIX_LEN = 4;
const UUID_CHARSET_RE = /^[0-9a-f-]+$/i;

/**
 * Resolve a user-supplied reference into an Invoice. Tries in order:
 *   1. Full UUID (`store.get(ref)`).
 *   2. Short UUID prefix (`inv.id.startsWith(ref)`), when ref looks like hex
 *      and is at least 4 chars.
 *   3. Invoice number exact match (`String(inv.default.invoiceNumber) === ref`).
 *
 * Matches from (2) and (3) are merged and deduped by id. Single hit → ok.
 * Multiple distinct invoices → `ambiguous`. None → `not-found`.
 */
export async function resolveInvoice(store: InvoiceStore, ref: string): Promise<ResolveResult> {
  // (1) Full UUID
  const byId = await store.get(ref);
  if (byId) return { ok: true, invoice: byId };

  // (2) + (3) need the full list
  const all = await store.list();
  const isValidPrefix = ref.length >= MIN_PREFIX_LEN && UUID_CHARSET_RE.test(ref);
  const byPrefix = isValidPrefix ? all.filter((inv) => inv.id.startsWith(ref)) : [];
  const byNumber = all.filter((inv) => String(inv.default.invoiceNumber) === ref);

  const merged = new Map<string, Invoice>();
  for (const inv of [...byPrefix, ...byNumber]) merged.set(inv.id, inv);
  const matches = [...merged.values()];

  if (matches.length === 0) return { ok: false, reason: 'not-found' };
  if (matches.length === 1) return { ok: true, invoice: matches[0]! };
  return { ok: false, reason: 'ambiguous', matches };
}

/**
 * Print a friendly error for a failed resolution and exit non-zero. Marked
 * `never` so TypeScript narrows `result.ok` to `true` after a `!result.ok`
 * guard in the caller.
 */
export function exitWithResolveError(
  ref: string,
  result: Extract<ResolveResult, { ok: false }>,
): never {
  if (result.reason === 'not-found') {
    console.error(`No invoice matching: ${ref}`);
  } else {
    console.error(`Ambiguous reference "${ref}" matches ${result.matches.length} invoices:`);
    for (const inv of result.matches) {
      const short = inv.id.slice(0, 8);
      const number = String(inv.default.invoiceNumber ?? '');
      const customer = String(inv.default.customerName ?? '');
      console.error(`  ${short}  ${number.padEnd(20)}  ${customer}`);
    }
    console.error('\nUse the full UUID or a longer prefix to disambiguate.');
  }
  process.exit(1);
}
