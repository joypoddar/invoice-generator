import type { Invoice } from '@invoice/shared';

export interface RecencyFilter {
  /** When true, only consider invoices with status='draft'. */
  drafts?: boolean;
}

/**
 * Pick the most recently-touched invoice from a pool.
 *
 * Ordering (DESC): issueDate, then sentAt (drafts have null and sort last
 * within an issueDate tie), then invoiceNumber as a final lexicographic
 * tiebreaker. ISO date strings compare correctly with localeCompare.
 */
export function mostRecent(invoices: Invoice[], filter: RecencyFilter = {}): Invoice | null {
  const pool = filter.drafts ? invoices.filter((i) => i.status === 'draft') : invoices;
  if (pool.length === 0) return null;
  return [...pool].sort(compareByRecency)[0] ?? null;
}

function compareByRecency(a: Invoice, b: Invoice): number {
  const aIssue = String(a.default.issueDate ?? '');
  const bIssue = String(b.default.issueDate ?? '');
  if (aIssue !== bIssue) return bIssue.localeCompare(aIssue);
  const aSent = a.sentAt ?? '';
  const bSent = b.sentAt ?? '';
  if (aSent !== bSent) return bSent.localeCompare(aSent);
  const aNum = String(a.default.invoiceNumber ?? '');
  const bNum = String(b.default.invoiceNumber ?? '');
  return bNum.localeCompare(aNum);
}
