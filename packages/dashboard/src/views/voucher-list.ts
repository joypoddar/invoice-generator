import { formatCurrency } from '@invoice/renderer';
import { voucherPaymentStatus, voucherTotal, type Voucher } from '@invoice/shared';
import { BATCH_CAP } from './voucher-batch.js';

export function renderVoucherListPage(vouchers: Voucher[]): string {
  const rows =
    vouchers.length === 0
      ? `<tr><td colspan="6" style="padding:32px; text-align:center; color:#888;">
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
    .btn-print {
      background:#3949ab; color:#fff; border:none; padding:9px 18px;
      border-radius:6px; font-size:14px; font-weight:600; cursor:pointer;
    }
    .btn-print:disabled { background:#a3a8c4; cursor:not-allowed; }
    .nav a { color:#3949ab; text-decoration:none; font-size:14px; margin-right:14px; }
    .nav a.active { font-weight:700; text-decoration:underline; }
    table { width:100%; border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 1px 4px rgba(57,73,171,0.08); }
    thead { background:#3949ab; color:#fff; }
    th, td { padding:11px 14px; text-align:left; font-size:13px; }
    th.check, td.check { width:34px; text-align:center; padding-left:14px; padding-right:6px; }
    input[type="checkbox"] { cursor:pointer; width:16px; height:16px; }
    tbody tr { border-top:1px solid #eef0fb; }
    tbody tr:hover { background:#f9faff; }
    a.row-link { color:#3949ab; text-decoration:none; font-weight:600; }
    a.row-link:hover { text-decoration:underline; }
    .num { font-variant-numeric:tabular-nums; }
    .badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
    .badge-paid { background:#dcfce7; color:#15803d; }
    .badge-unpaid { background:#fef3c7; color:#92400e; }
    @media print { .no-print { display:none !important; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar no-print">
      <h1>Vouchers</h1>
      <span class="nav"><a href="/invoices">Invoices</a><a href="/vouchers" class="active">Vouchers</a></span>
      <button id="print-selected" class="btn-print" disabled>🖨 Print selected</button>
    </div>
    <table>
      <thead>
        <tr>
          <th class="check"><input type="checkbox" id="select-all" aria-label="Select all" /></th>
          <th>PV No.</th>
          <th>Pay To</th>
          <th>Date</th>
          <th>Status</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
  <script>
    (function () {
      var checkboxes = document.querySelectorAll('input[name="voucher"]');
      var selectAll = document.getElementById('select-all');
      var button = document.getElementById('print-selected');
      function count() {
        return document.querySelectorAll('input[name="voucher"]:checked').length;
      }
      function update() {
        var n = count();
        button.textContent = n > 0 ? '🖨 Print selected (' + n + ')' : '🖨 Print selected';
        button.disabled = n === 0;
        if (selectAll) selectAll.checked = n > 0 && n === checkboxes.length;
      }
      if (selectAll) {
        selectAll.addEventListener('change', function (e) {
          var checked = e.target.checked;
          checkboxes.forEach(function (cb) { cb.checked = checked; });
          update();
        });
      }
      checkboxes.forEach(function (cb) { cb.addEventListener('change', update); });
      button.addEventListener('click', function () {
        var ids = Array.from(document.querySelectorAll('input[name="voucher"]:checked'))
          .map(function (cb) { return cb.value; });
        if (ids.length === 0) return;
        if (ids.length > ${BATCH_CAP}) {
          var ok = confirm('You selected ' + ids.length + ' vouchers. Only the first ${BATCH_CAP} will be printed. Continue?');
          if (!ok) return;
          ids = ids.slice(0, ${BATCH_CAP});
        }
        window.location.href = '/vouchers/print?ids=' + encodeURIComponent(ids.join(','));
      });
      update();
    })();
  </script>
</body>
</html>`;
}

function renderRow(v: Voucher): string {
  const total = formatCurrency(voucherTotal(v), v.currency || 'INR');
  const status = voucherPaymentStatus(v);
  const paidBadge =
    status === 'paid'
      ? `<span class="badge badge-paid">paid</span>`
      : `<span class="badge badge-unpaid">unpaid</span>`;
  return `<tr>
    <td class="check"><input type="checkbox" name="voucher" value="${escapeAttr(v.id)}" aria-label="Select voucher ${escapeAttr(v.voucherNumber)}" /></td>
    <td><a class="row-link" href="/vouchers/${escapeAttr(v.id)}">${escapeHtml(v.voucherNumber)}</a></td>
    <td>${escapeHtml(v.payTo)}</td>
    <td class="num">${escapeHtml(v.date)}</td>
    <td>${paidBadge}</td>
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
