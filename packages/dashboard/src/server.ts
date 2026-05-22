import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { SqliteStore } from '@invoice/core';
import type { Invoice } from '@invoice/shared';
import { renderInvoiceDetailPage } from './views/invoice-detail.js';
import { renderInvoiceListPage } from './views/invoice-list.js';

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

function notFoundPage(id: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Not found</title></head>
<body style="font-family:sans-serif; padding:48px; color:#333;">
<h1>Invoice not found</h1>
<p>No invoice in the local DB with id <code>${escapeHtml(id)}</code>.</p>
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
