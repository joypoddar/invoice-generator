import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ImapFlow } from 'imapflow';
import type { Invoice } from '@invoice/shared';
import { ingest, parseSidecar } from './ingest.js';
import { SqliteStore } from './sqlite-store.js';
import type { FetchedMessage } from './imap.js';

function makeInvoice(): Invoice {
  return {
    id: randomUUID(),
    default: {
      invoiceNumber: 'INV-2026-0001',
      fromName: 'Joy',
      fromEmail: 'joy@creowis.com',
      customerName: 'Acme',
      customerEmail: 'pay@acme.com',
      issueDate: '2026-05-17',
      dueDate: '2026-06-17',
      currency: 'USD',
      lineItems: [{ description: 'Consulting', quantity: 5, unitPrice: 150 }],
      notes: '',
    },
    custom: {},
    status: 'sent',
    sentAt: '2026-05-17T12:00:00Z',
    paymentStatus: 'unpaid',
  };
}

/**
 * Build a raw multipart/mixed RFC 822 message with the X-Invoice-Generator
 * header and a JSON sidecar attachment.
 */
function buildEmail(invoice: Invoice, overrides: { skipHeader?: boolean; sidecarName?: string } = {}): Buffer {
  const json = JSON.stringify(invoice);
  const boundary = `b-${Math.random().toString(36).slice(2)}`;
  const filename = overrides.sidecarName ?? `invoice-${String(invoice.default.invoiceNumber)}.json`;
  const headerLines = [
    'From: joy@creowis.com',
    'To: hello@creowis.com',
    `Subject: [Invoice] ${String(invoice.default.invoiceNumber)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  if (!overrides.skipHeader) headerLines.push('X-Invoice-Generator: 1');
  const bodyLines = [
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body>Invoice</body></html>',
    `--${boundary}`,
    `Content-Type: application/json; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    json,
    `--${boundary}--`,
  ];
  return Buffer.from([...headerLines, ...bodyLines].join('\r\n'));
}

function makeMessage(uid: number, invoice: Invoice, opts?: { skipHeader?: boolean; sidecarName?: string }): FetchedMessage {
  return { uid, source: buildEmail(invoice, opts) };
}

/**
 * Stand-in for ImapFlow that yields a canned list of messages. Only implements
 * the methods `fetchSince` uses, cast through `unknown` for type compatibility.
 */
function createMockClient(messages: FetchedMessage[]): ImapFlow {
  const uids = messages.map((m) => m.uid);
  return {
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    search: vi.fn(async () => uids),
    fetch: vi.fn(() => {
      return (async function* () {
        for (const m of messages) yield m;
      })();
    }),
  } as unknown as ImapFlow;
}

describe('parseSidecar', () => {
  it('extracts the Invoice from a well-formed message', async () => {
    const inv = makeInvoice();
    const parsed = await parseSidecar(makeMessage(1, inv));
    expect(parsed).toEqual(inv);
  });

  it('returns null when X-Invoice-Generator header is missing', async () => {
    const inv = makeInvoice();
    const parsed = await parseSidecar(makeMessage(1, inv, { skipHeader: true }));
    expect(parsed).toBeNull();
  });

  it('returns null when no invoice-*.json attachment is present', async () => {
    const inv = makeInvoice();
    const parsed = await parseSidecar(makeMessage(1, inv, { sidecarName: 'random.txt' }));
    expect(parsed).toBeNull();
  });
});

describe('ingest', () => {
  it('returns zero count and unchanged lastUid for empty inbox', async () => {
    const store = new SqliteStore(':memory:');
    const client = createMockClient([]);
    const result = await ingest(store, client, 'Sent', 0);
    expect(result.syncedCount).toBe(0);
    expect(result.newLastUid).toBe(0);
    store.close();
  });

  it('upserts each matching message and reports the right counts', async () => {
    const store = new SqliteStore(':memory:');
    const inv1 = makeInvoice();
    const inv2 = makeInvoice();
    const client = createMockClient([makeMessage(100, inv1), makeMessage(101, inv2)]);

    const result = await ingest(store, client, 'Sent', 0);

    expect(result.syncedCount).toBe(2);
    expect(result.newLastUid).toBe(101);
    expect(await store.count()).toBe(2);
    expect(await store.get(inv1.id)).toEqual(inv1);
    expect(await store.get(inv2.id)).toEqual(inv2);
    store.close();
  });

  it('skips messages whose sidecar is missing', async () => {
    const store = new SqliteStore(':memory:');
    const goodInv = makeInvoice();
    const badInv = makeInvoice();
    const client = createMockClient([
      makeMessage(50, goodInv),
      makeMessage(51, badInv, { sidecarName: 'not-an-invoice.txt' }),
    ]);

    const result = await ingest(store, client, 'Sent', 0);

    expect(result.syncedCount).toBe(1);
    // newLastUid should not advance past skipped messages (we never confirmed them)
    expect(result.newLastUid).toBe(50);
    expect(await store.count()).toBe(1);
    store.close();
  });

  it('is idempotent: re-running with the same lastUid does not duplicate rows', async () => {
    const store = new SqliteStore(':memory:');
    const inv = makeInvoice();
    const client = createMockClient([makeMessage(200, inv)]);

    await ingest(store, client, 'Sent', 0);
    await ingest(store, client, 'Sent', 0); // simulate a re-sync of the same UID

    expect(await store.count()).toBe(1);
    store.close();
  });
});
