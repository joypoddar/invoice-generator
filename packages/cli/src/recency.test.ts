import { describe, expect, it } from 'vitest';
import type { Invoice } from '@invoice/shared';
import { mostRecent } from './recency.js';

function inv(
  id: string,
  fields: {
    issueDate?: string;
    invoiceNumber?: string;
    sentAt?: string;
    status?: 'draft' | 'sent';
  } = {},
): Invoice {
  return {
    id,
    default: {
      issueDate: fields.issueDate ?? '2026-01-01',
      invoiceNumber: fields.invoiceNumber ?? id,
    },
    custom: {},
    status: fields.status ?? 'draft',
    paymentStatus: 'unpaid',
    ...(fields.sentAt ? { sentAt: fields.sentAt } : {}),
  };
}

describe('mostRecent', () => {
  it('returns null on an empty pool', () => {
    expect(mostRecent([])).toBeNull();
  });

  it('picks the invoice with the highest issueDate', () => {
    const a = inv('a', { issueDate: '2026-05-01' });
    const b = inv('b', { issueDate: '2026-05-17' });
    const c = inv('c', { issueDate: '2026-04-30' });
    expect(mostRecent([a, b, c])?.id).toBe('b');
  });

  it('tiebreaks on sentAt within the same issueDate', () => {
    const draftLater = inv('draft', { issueDate: '2026-05-01' });
    const sentEarly = inv('s1', { issueDate: '2026-05-01', status: 'sent', sentAt: '2026-05-02T10:00:00Z' });
    const sentLate = inv('s2', { issueDate: '2026-05-01', status: 'sent', sentAt: '2026-05-03T10:00:00Z' });
    expect(mostRecent([draftLater, sentEarly, sentLate])?.id).toBe('s2');
  });

  it('falls back to invoiceNumber DESC when issueDate and sentAt are equal', () => {
    const a = inv('a', { issueDate: '2026-05-01', invoiceNumber: 'INV-001' });
    const b = inv('b', { issueDate: '2026-05-01', invoiceNumber: 'INV-099' });
    expect(mostRecent([a, b])?.id).toBe('b');
  });

  it('filters to drafts when drafts=true', () => {
    const draft = inv('d', { issueDate: '2026-05-01', status: 'draft' });
    const sentLater = inv('s', {
      issueDate: '2026-05-17',
      status: 'sent',
      sentAt: '2026-05-18T00:00:00Z',
    });
    expect(mostRecent([draft, sentLater])?.id).toBe('s');
    expect(mostRecent([draft, sentLater], { drafts: true })?.id).toBe('d');
  });

  it('returns null when no invoice matches the drafts filter', () => {
    const sent = inv('s', { status: 'sent', sentAt: '2026-05-18T00:00:00Z' });
    expect(mostRecent([sent], { drafts: true })).toBeNull();
  });
});
