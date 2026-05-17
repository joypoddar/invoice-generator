import { simpleParser } from 'mailparser';
import { INVOICE_HEADER_NAME, type Invoice } from '@invoice/shared';
import { fetchSince, type FetchedMessage } from './imap.js';
import type { InvoiceStore } from './store.js';
import type { ImapFlow } from 'imapflow';

const SIDECAR_FILENAME_RE = /^invoice-.+\.json$/i;

export interface IngestResult {
  syncedCount: number;
  newLastUid: number;
}

/**
 * Pull new invoices from an IMAP folder into the store. Same function called from
 * `invoice sync` (CLI) and `POST /sync` (dashboard) so behavior cannot drift.
 */
export async function ingest(
  store: InvoiceStore,
  client: ImapFlow,
  folder: string,
  lastUid: number,
): Promise<IngestResult> {
  let syncedCount = 0;
  let newLastUid = lastUid;

  for await (const msg of fetchSince(client, folder, lastUid)) {
    const invoice = await parseSidecar(msg);
    if (!invoice) continue;
    await store.upsert(invoice, { messageUid: String(msg.uid) });
    syncedCount++;
    if (msg.uid > newLastUid) newLastUid = msg.uid;
  }

  return { syncedCount, newLastUid };
}

/**
 * Parse an IMAP message, looking for the `invoice-*.json` sidecar attachment.
 * Returns null if no sidecar is present or the JSON doesn't decode.
 */
export async function parseSidecar(msg: FetchedMessage): Promise<Invoice | null> {
  const parsed = await simpleParser(msg.source);

  // Header sanity — sync's IMAP search filters on this, but if we somehow get a
  // message without the header (e.g., during a unit-test mock), skip it.
  const header = parsed.headers.get(INVOICE_HEADER_NAME.toLowerCase());
  if (!header) return null;

  const sidecar = parsed.attachments.find((a) => SIDECAR_FILENAME_RE.test(a.filename ?? ''));
  if (!sidecar) return null;

  try {
    return JSON.parse(sidecar.content.toString('utf8')) as Invoice;
  } catch {
    return null;
  }
}
