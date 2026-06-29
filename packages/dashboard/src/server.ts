import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { SqliteStore } from '@invoice/core';
import type { Invoice } from '@invoice/shared';
import type { Voucher } from '@invoice/shared';
import { renderInvoiceDetailPage } from './views/invoice-detail.js';
import { renderInvoiceListPage } from './views/invoice-list.js';
import { BATCH_CAP, renderInvoiceBatchPage } from './views/invoice-batch.js';
import { renderVoucherDetailPage } from './views/voucher-detail.js';
import { renderVoucherListPage } from './views/voucher-list.js';

export interface StartServerResult {
  /** Stop the server. Returns when the underlying socket is closed. */
  stop: () => Promise<void>;
}

export interface StartServerOptions {
  port: number;
  dbPath: string;
  /**
   * Render opts passed through to `renderInvoiceHtml` (branding, dateFormat,
   * currencyFormat). The CLI's `dashboard` command pulls these from config.
   */
  renderOpts?: {
    branding?: {
      primaryColor?: string;
      fontFamily?: string;
      logoUrl?: string;
      signatureUrl?: string;
      signatoryLabel?: string;
    };
    dateFormat?: string;
    currencyFormat?: string;
  };
  /**
   * The current install's display name (`config.name`). Used to build the
   * batch-print page's <title> tag (and therefore the suggested PDF filename
   * like `john_doe_invoices_2026-05-22.pdf`). Empty string is fine — falls
   * back to `invoices_<date>`.
   */
  localUserName?: string;
}

export function startServer(opts: StartServerOptions): StartServerResult {
  const app = new Hono();

  app.get('/', (c) => c.redirect('/invoices'));

  app.get('/invoices', async (c) => {
    const store = new SqliteStore(opts.dbPath);
    let invoices: Invoice[];
    try {
      invoices = await store.list();
    } finally {
      store.close();
    }
    return c.html(renderInvoiceListPage(invoices));
  });

  // Batch route MUST be registered BEFORE `/invoices/:id` so Hono matches it
  // first. Otherwise `/invoices/print` falls through to the detail handler.
  app.get('/invoices/print', async (c) => {
    const idsParam = c.req.query('ids') ?? '';
    const requested = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (requested.length === 0) {
      return c.html(noSelectionPage(), 404);
    }
    const capped = requested.slice(0, BATCH_CAP);
    const store = new SqliteStore(opts.dbPath);
    const invoices: Invoice[] = [];
    try {
      for (const id of capped) {
        const inv = await store.get(id);
        if (inv) invoices.push(inv);
      }
    } finally {
      store.close();
    }
    if (invoices.length === 0) {
      return c.html(noSelectionPage(), 404);
    }
    return c.html(
      renderInvoiceBatchPage(invoices, {
        localUserName: opts.localUserName ?? '',
        renderOpts: opts.renderOpts,
      }),
    );
  });

  app.get('/invoices/:id', async (c) => {
    const id = c.req.param('id');
    const store = new SqliteStore(opts.dbPath);
    let invoice: Invoice | null;
    try {
      invoice = await store.get(id);
    } finally {
      store.close();
    }
    if (!invoice) {
      return c.html(notFoundPage(id), 404);
    }
    return c.html(renderInvoiceDetailPage(invoice, opts.renderOpts));
  });

  app.get('/vouchers', async (c) => {
    const store = new SqliteStore(opts.dbPath);
    let vouchers: Voucher[];
    try {
      vouchers = store.listVouchers();
    } finally {
      store.close();
    }
    return c.html(renderVoucherListPage(vouchers));
  });

  app.get('/vouchers/:id', async (c) => {
    const id = c.req.param('id');
    const store = new SqliteStore(opts.dbPath);
    let voucher: Voucher | null;
    try {
      voucher = store.getVoucher(id);
    } finally {
      store.close();
    }
    if (!voucher) {
      return c.html(notFoundPage(id, 'voucher'), 404);
    }
    return c.html(renderVoucherDetailPage(voucher, opts.renderOpts));
  });

  const server: ServerType = serve({
    fetch: app.fetch,
    port: opts.port,
    hostname: '127.0.0.1', // bind locally only — never reachable from the LAN
  });

  return {
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function notFoundPage(id: string, kind: 'invoice' | 'voucher' = 'invoice'): string {
  const listPath = kind === 'voucher' ? '/vouchers' : '/invoices';
  const listLabel = kind === 'voucher' ? '← All vouchers' : '← All invoices';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Not found</title></head>
<body style="font-family:sans-serif; padding:48px; color:#333;">
<h1>${kind === 'voucher' ? 'Voucher' : 'Invoice'} not found</h1>
<p>No ${kind} in the local DB with id <code>${escapeHtml(id)}</code>.</p>
<p><a href="${listPath}">${listLabel}</a></p>
</body></html>`;
}

function noSelectionPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Nothing to print</title></head>
<body style="font-family:sans-serif; padding:48px; color:#333;">
<h1>Nothing to print</h1>
<p>The selection was empty or matched no invoices in the local DB.</p>
<p><a href="/invoices">← All invoices</a></p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
