import { formatCurrency } from '@invoice/renderer';
import { voucherTotal, type Voucher } from '@invoice/shared';

export function renderVoucherListPage(vouchers: Voucher[]): string {
  const rows =
    vouchers.length === 0
      ? `<tr><td colspan="4" style="padding:32px; text-align:center; color:#888;">
           No vouchers yet. Create one with <code>invoice voucher new</code>.
         </td></tr>`
      : vouchers.map(renderRow).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vouchers</title>
  <style>
    body { margin:0; padding:0; background:#f4f6fb; font-family:'Segoe UI',Arial,sans-serif; color:#222; }
    .wrap { max-width:1080px; margin:0 auto; padding:0 24px 32px; }
    .toolbar {
      position:sticky; top:0; z-index:10;
      background:#f4f6fb; padding:20px 0;
      display:flex; gap:16px; align-items:center;
      border-bottom:1px solid #e5e7eb; margin-bottom:16px;
    }
    h1 { margin:0; font-size:24px; color:#3949ab; flex:1; }
    .nav a { color:#3949ab; text-decoration:none; font-size:14px; margin-right:14px; }
    .nav a.active { font-weight:700; text-decoration:underline; }
    table { width:100%; border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 1px 4px rgba(57,73,171,0.08); }
    thead { background:#3949ab; color:#fff; }
    th, td { padding:11px 14px; text-align:left; font-size:13px; }
    tbody tr { border-top:1px solid #eef0fb; }
    tbody tr:hover { background:#f9faff; }
    a.row-link { color:#3949ab; text-decoration:none; font-weight:600; }
    a.row-link:hover { text-decoration:underline; }
    .num { font-variant-numeric:tabular-nums; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar">
      <h1>Vouchers</h1>
      <span class="nav"><a href="/invoices">Invoices</a><a href="/vouchers" class="active">Vouchers</a></span>
    </div>
    <table>
      <thead>
        <tr>
          <th>PV No.</th>
          <th>Pay To</th>
          <th>Date</th>
          <th style="text-align:right;">Total</th>
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

function renderRow(v: Voucher): string {
  const total = formatCurrency(voucherTotal(v), v.currency || 'INR');
  return `<tr>
    <td><a class="row-link" href="/vouchers/${escapeAttr(v.id)}">${escapeHtml(v.voucherNumber)}</a></td>
    <td>${escapeHtml(v.payTo)}</td>
    <td class="num">${escapeHtml(v.date)}</td>
    <td class="num" style="text-align:right;">${escapeHtml(total)}</td>
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
