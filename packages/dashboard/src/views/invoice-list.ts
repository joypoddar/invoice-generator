import { totalFor, type Invoice } from '@invoice/shared';

const SHORT_ID_LEN = 8;
const BATCH_CAP = 50;

export function renderInvoiceListPage(invoices: Invoice[]): string {
  const rows =
    invoices.length === 0
      ? `<tr><td colspan="8" style="padding:32px; text-align:center; color:#888;">
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
    .wrap { max-width:1080px; margin:0 auto; padding:0 24px 32px; }
    h1 { margin:0 0 20px; font-size:24px; color:#3949ab; }
    .toolbar {
      position:sticky; top:0; z-index:10;
      background:#f4f6fb; padding:20px 0;
      display:flex; gap:12px; align-items:center;
      border-bottom:1px solid #e5e7eb; margin-bottom:16px;
    }
    .btn-print {
      background:#3949ab; color:#fff; border:none; padding:9px 18px;
      border-radius:6px; font-size:14px; font-weight:600; cursor:pointer;
    }
    .btn-print:disabled { background:#a3a8c4; cursor:not-allowed; }
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
    .badge-draft { background:#e5e7eb; color:#374151; }
    .badge-sent { background:#dbeafe; color:#1d4ed8; }
    @media print { .no-print { display:none !important; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="toolbar no-print">
      <h1 style="margin:0; flex:1;">Invoices</h1>
      <button id="print-selected" class="btn-print" disabled>🖨 Print selected</button>
    </div>
    <table>
      <thead>
        <tr>
          <th class="check"><input type="checkbox" id="select-all" aria-label="Select all" /></th>
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
  <script>
    (function () {
      var checkboxes = document.querySelectorAll('input[name="invoice"]');
      var selectAll = document.getElementById('select-all');
      var button = document.getElementById('print-selected');
      function count() {
        return document.querySelectorAll('input[name="invoice"]:checked').length;
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
        var ids = Array.from(document.querySelectorAll('input[name="invoice"]:checked'))
          .map(function (cb) { return cb.value; });
        if (ids.length === 0) return;
        if (ids.length > ${BATCH_CAP}) {
          var ok = confirm('You selected ' + ids.length + ' invoices. Only the first ${BATCH_CAP} will be printed. Continue?');
          if (!ok) return;
          ids = ids.slice(0, ${BATCH_CAP});
        }
        window.location.href = '/invoices/print?ids=' + encodeURIComponent(ids.join(','));
      });
      update();
    })();
  </script>
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
    <td class="check"><input type="checkbox" name="invoice" value="${escapeAttr(inv.id)}" aria-label="Select invoice ${escapeAttr(number)}" /></td>
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
