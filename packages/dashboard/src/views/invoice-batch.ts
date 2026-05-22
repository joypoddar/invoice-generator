import {
  PRINT_CSS,
  renderInvoiceCard,
  slugify,
  type RenderOpts,
} from '@invoice/renderer';
import type { Invoice } from '@invoice/shared';

export const BATCH_CAP = 50;

export interface BatchPageOptions {
  /**
   * Identity of whoever is printing right now (the local install's `config.name`).
   * Used to build the document <title> (and therefore the suggested PDF filename).
   */
  localUserName: string;
  renderOpts?: RenderOpts;
  /**
   * Override "today" for deterministic test output. ISO date string `YYYY-MM-DD`.
   * Production callers omit this and let the page render the live date.
   */
  today?: string;
}

/**
 * Render multiple invoices stacked into a single document, each on its own
 * printed page. Auto-fires `window.print()` 100ms after load — the user
 * already clicked "Print selected" on the list page so intent is explicit.
 */
export function renderInvoiceBatchPage(
  invoices: Invoice[],
  opts: BatchPageOptions,
): string {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const senderSlug = slugify(opts.localUserName);
  const titleBase = senderSlug
    ? `${senderSlug}_invoices_${today}`
    : `invoices_${today}`;
  const fontFamily =
    opts.renderOpts?.branding?.fontFamily ?? "'Segoe UI', Arial, sans-serif";

  const cards = invoices
    .map((inv, i) => {
      const card = renderInvoiceCard(inv, opts.renderOpts);
      // First invoice flows naturally; every subsequent invoice starts on a
      // fresh printed page via the page-break-before wrapper.
      if (i === 0) return card;
      return `<div style="page-break-before: always; break-before: page;">${card}</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(titleBase)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body style="margin:0; padding:32px 16px; background:#f4f6fb; font-family: ${fontFamily};">
  <div class="no-print" style="max-width:680px; margin:0 auto 20px; display:flex; align-items:center; gap:12px;">
    <a href="/invoices" style="color:#3949ab; text-decoration:none; font-size:14px; font-weight:600;">← Back</a>
    <span style="flex:1;"></span>
    <span style="color:#666; font-size:13px;">Printing ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} — print dialog should open automatically.</span>
  </div>
  ${cards}
  <script>setTimeout(function () { window.print(); }, 100);</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
