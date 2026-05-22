import { renderInvoiceHtml, type RenderOpts } from '@invoice/renderer';
import type { Invoice } from '@invoice/shared';

/**
 * Wrap the canonical `renderInvoiceHtml` output with a tiny toolbar at the top.
 * The toolbar is class="no-print" so it disappears in window.print() — matching
 * the existing `.no-print` rule baked into the renderer's `@media print` block.
 *
 * `window.print()` works here because this is a real browser context (unlike
 * email clients, which strip <script> tags and onclick handlers).
 */
export function renderInvoiceDetailPage(invoice: Invoice, opts?: RenderOpts): string {
  const card = renderInvoiceHtml(invoice, opts);
  return injectToolbar(card);
}

const TOOLBAR_HTML = `<div class="no-print" style="position:sticky; top:0; z-index:10;
  background:#fff; border-bottom:1px solid #e5e7eb; padding:14px 24px;
  display:flex; gap:12px; align-items:center; font-family:'Segoe UI',Arial,sans-serif;">
  <a href="/invoices" style="color:#3949ab; text-decoration:none; font-size:14px;">← All invoices</a>
  <span style="flex:1;"></span>
  <button onclick="window.print()" style="background:#3949ab; color:#fff;
    border:none; padding:9px 18px; border-radius:6px; font-size:14px;
    font-weight:600; cursor:pointer;">
    🖨 Print / Save as PDF
  </button>
</div>`;

/**
 * Insert the toolbar immediately after the opening `<body ...>` tag of the
 * renderer's HTML. The body's inline style includes `padding:32px 16px`; the
 * sticky toolbar appears above the invoice card.
 */
function injectToolbar(html: string): string {
  // Match the body tag with its inline style; insert the toolbar right after.
  return html.replace(/<body([^>]*)>/, `<body$1>\n${TOOLBAR_HTML}`);
}
