import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ImapFlow } from 'imapflow';
import type { Invoice, Voucher } from '@invoice/shared';
import { ingest, ingestVouchers, parseSidecar, parseVoucherSidecar } from './ingest.js';
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
function buildEmail(
  invoice: Invoice,
  overrides: { skipHeader?: boolean; sidecarName?: string } = {},
): Buffer {
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

function makeMessage(
  uid: number,
  invoice: Invoice,
  opts?: { skipHeader?: boolean; sidecarName?: string },
): FetchedMessage {
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
  it('returns zero counts and unchanged lastUid for empty inbox', async () => {
    const store = new SqliteStore(':memory:');
    const client = createMockClient([]);
    const result = await ingest(store, client, 'Sent', 0);
    expect(result.fetchedCount).toBe(0);
    expect(result.newCount).toBe(0);
    expect(result.newLastUid).toBe(0);
    store.close();
  });

  it('upserts each matching message and reports the right counts', async () => {
    const store = new SqliteStore(':memory:');
    const inv1 = makeInvoice();
    const inv2 = makeInvoice();
    const client = createMockClient([makeMessage(100, inv1), makeMessage(101, inv2)]);

    const result = await ingest(store, client, 'Sent', 0);

    expect(result.fetchedCount).toBe(2);
    expect(result.newCount).toBe(2);
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

    expect(result.fetchedCount).toBe(1);
    expect(result.newCount).toBe(1);
    // newLastUid should not advance past skipped messages (we never confirmed them)
    expect(result.newLastUid).toBe(50);
    expect(await store.count()).toBe(1);
    store.close();
  });

  it('counts re-ingested rows as fetched but not new (e.g. --backfill)', async () => {
    const store = new SqliteStore(':memory:');
    const inv = makeInvoice();
    const client = createMockClient([makeMessage(200, inv)]);

    const first = await ingest(store, client, 'Sent', 0);
    expect(first.fetchedCount).toBe(1);
    expect(first.newCount).toBe(1);

    // Re-run with lastUid=0 (simulates --backfill on an existing DB)
    const second = await ingest(store, client, 'Sent', 0);
    expect(second.fetchedCount).toBe(1);
    expect(second.newCount).toBe(0);

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

function makeVoucher(): Voucher {
  return {
    id: randomUUID(),
    voucherNumber: 'JP_May26_01',
    title: 'Employee Payment Voucher',
    payTo: 'Github Copilot',
    date: '2026-05-07',
    currency: 'INR',
    lines: [{ paymentMethod: 'Credit Card', description: 'Subscription', amount: 186 }],
    preparedBy: 'Joy Poddar',
    receivedBy: 'Joy Poddar',
    createdAt: '2026-05-07T00:00:00.000Z',
    status: 'sent',
    sentAt: '2026-05-07T12:00:00.000Z',
    paymentStatus: 'unpaid',
  };
}

function buildVoucherEmail(
  voucher: Voucher,
  overrides: { skipHeader?: boolean; sidecarName?: string } = {},
): Buffer {
  const json = JSON.stringify(voucher);
  const boundary = `b-${Math.random().toString(36).slice(2)}`;
  const filename = overrides.sidecarName ?? `voucher-${voucher.voucherNumber}.json`;
  const headerLines = [
    'From: joy@creowis.com',
    'To: hello@creowis.com',
    `Subject: Payment Voucher ${voucher.voucherNumber}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  if (!overrides.skipHeader) headerLines.push('X-Voucher-Generator: 1');
  const bodyLines = [
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body>Voucher</body></html>',
    `--${boundary}`,
    `Content-Type: application/json; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    json,
    `--${boundary}--`,
  ];
  return Buffer.from([...headerLines, ...bodyLines].join('\r\n'));
}

function makeVoucherMessage(
  uid: number,
  voucher: Voucher,
  opts?: { skipHeader?: boolean; sidecarName?: string },
): FetchedMessage {
  return { uid, source: buildVoucherEmail(voucher, opts) };
}

describe('parseVoucherSidecar', () => {
  it('extracts the Voucher from a well-formed message', async () => {
    const v = makeVoucher();
    const parsed = await parseVoucherSidecar(makeVoucherMessage(1, v));
    expect(parsed).toEqual(v);
  });

  it('returns null when X-Voucher-Generator header is missing', async () => {
    const parsed = await parseVoucherSidecar(
      makeVoucherMessage(1, makeVoucher(), { skipHeader: true }),
    );
    expect(parsed).toBeNull();
  });

  it('returns null when no voucher-*.json attachment is present', async () => {
    const parsed = await parseVoucherSidecar(
      makeVoucherMessage(1, makeVoucher(), { sidecarName: 'invoice-INV-1.json' }),
    );
    expect(parsed).toBeNull();
  });
});

describe('ingestVouchers', () => {
  it('upserts each matching voucher and reports the right counts', async () => {
    const store = new SqliteStore(':memory:');
    const v1 = makeVoucher();
    const v2 = makeVoucher();
    const client = createMockClient([makeVoucherMessage(100, v1), makeVoucherMessage(101, v2)]);

    const result = await ingestVouchers(store, client, 'Sent', 0);

    expect(result.fetchedCount).toBe(2);
    expect(result.newCount).toBe(2);
    expect(result.newLastUid).toBe(101);
    expect(store.listVouchers()).toHaveLength(2);
    expect(store.getVoucher(v1.id)).toEqual(v1);
    store.close();
  });

  it('counts re-ingested vouchers as fetched but not new', async () => {
    const store = new SqliteStore(':memory:');
    const v = makeVoucher();
    const client = createMockClient([makeVoucherMessage(200, v)]);

    const first = await ingestVouchers(store, client, 'Sent', 0);
    expect(first.newCount).toBe(1);

    const second = await ingestVouchers(store, client, 'Sent', 0);
    expect(second.fetchedCount).toBe(1);
    expect(second.newCount).toBe(0);
    expect(store.listVouchers()).toHaveLength(1);
    store.close();
  });

  it('does not advance the watermark past a voucher with no sidecar', async () => {
    const store = new SqliteStore(':memory:');
    const good = makeVoucher();
    const bad = makeVoucher();
    const client = createMockClient([
      makeVoucherMessage(50, good),
      makeVoucherMessage(51, bad, { sidecarName: 'nope.txt' }),
    ]);

    const result = await ingestVouchers(store, client, 'Sent', 0);
    expect(result.fetchedCount).toBe(1);
    expect(result.newLastUid).toBe(50);
    store.close();
  });
});
