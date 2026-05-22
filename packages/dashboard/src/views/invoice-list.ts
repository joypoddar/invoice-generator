import { totalFor, type Invoice } from '@invoice/shared';

const SHORT_ID_LEN = 8;

export function renderInvoiceListPage(invoices: Invoice[]): string {
  const rows =
    invoices.length === 0
      ? `<tr><td colspan="7" style="padding:32px; text-align:center; color:#888;">
           No invoices yet. Create one with <code>invoice new</code>, then sync with <code>invoice sync</code>.
         </td></tr>`
      : invoices.map(renderRow).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoices</title>
  <style>
    body { margin:0; padding:0; background:#f4f6fb; font-family:'Segoe UI',Arial,sans-serif; color:#222; }
    .wrap { max-width:1080px; margin:0 auto; padding:32px 24px; }
    h1 { margin:0 0 20px; font-size:24px; color:#3949ab; }
    table { width:100%; border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 1px 4px rgba(57,73,171,0.08); }
    thead { background:#3949ab; color:#fff; }
    th, td { padding:11px 14px; text-align:left; font-size:13px; }
    tbody tr { border-top:1px solid #eef0fb; }
    tbody tr:hover { background:#f9faff; }
    a.row-link { color:#3949ab; text-decoration:none; font-weight:600; }
    a.row-link:hover { text-decoration:underline; }
    .num { font-variant-numeric:tabular-nums; }
    .badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
    .badge-paid { background:#dcfce7; color:#15803d; }
    .badge-unpaid { background:#fef3c7; color:#92400e; }
    .badge-draft { background:#e5e7eb; color:#374151; }
    .badge-sent { background:#dbeafe; color:#1d4ed8; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Invoices</h1>
    <table>
      <thead>
        <tr>
          <th>Id</th>
          <th>Number</th>
          <th>Customer</th>
          <th>Due</th>
          <th>Status</th>
          <th style="text-align:right;">Total</th>
          <th>Paid?</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

function renderRow(inv: Invoice): string {
  const def = inv.default;
  const shortId = inv.id.slice(0, SHORT_ID_LEN);
  const number = String(def.invoiceNumber ?? '');
  const customer = String(def.customerName ?? '');
  const due = String(def.dueDate ?? '');
  const currency = String(def.currency ?? '');
  const total = totalFor(inv).toFixed(2);
  const statusBadge =
    inv.status === 'sent'
      ? `<span class="badge badge-sent">sent</span>`
      : `<span class="badge badge-draft">draft</span>`;
  const paidBadge =
    inv.paymentStatus === 'paid'
      ? `<span class="badge badge-paid">paid</span>`
      : `<span class="badge badge-unpaid">unpaid</span>`;

  return `<tr>
    <td><a class="row-link" href="/invoices/${escapeAttr(inv.id)}">${escapeHtml(shortId)}</a></td>
    <td>${escapeHtml(number)}</td>
    <td>${escapeHtml(customer)}</td>
    <td class="num">${escapeHtml(due)}</td>
    <td>${statusBadge}</td>
    <td class="num" style="text-align:right;">${escapeHtml(total)}${currency ? ' ' + escapeHtml(currency) : ''}</td>
    <td>${paidBadge}</td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
