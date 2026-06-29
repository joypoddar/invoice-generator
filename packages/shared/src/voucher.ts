export interface VoucherLine {
  paymentMethod: string;
  description: string;
  amount: number;
}

export interface Voucher {
  id: string;
  /** Display-only number (e.g. "JP_May26_02"). UUID `id` is the real key. */
  voucherNumber: string;
  /** Snapshot of the voucher title (e.g. "Employee Payment Voucher"). */
  title: string;
  /** Who is being paid. */
  payTo: string;
  /** Set when payTo was picked from the saved-customers directory. */
  customerSlug?: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  currency: string;
  lines: VoucherLine[];
  /** Header snapshots from config.company at creation time. */
  companyName?: string;
  companyAddress?: string;
  preparedBy: string;
  receivedBy: string;
  notes?: string;
  /** ISO timestamp the voucher was created. */
  createdAt: string;
}

const SEQ_PAD = 2;

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * Render a voucher number from a format template. Mirrors `renderInvoiceNumber`
 * but adds {INITIALS}, short/long month names, and a two-digit {YY}. {SEQ} is
 * zero-padded to two digits to match the reference design (e.g. "JP_May26_02").
 */
export function renderVoucherNumber(
  format: string,
  seq: number,
  date: Date = new Date(),
  initials?: string,
): string {
  const mi = date.getMonth(); // 0-based
  const seqStr = String(seq).padStart(SEQ_PAD, '0');
  const yyyy = String(date.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(mi + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const mmmm = LONG_MONTHS[mi] ?? '';
  const mmm = SHORT_MONTHS[mi] ?? '';
  return format
    .replaceAll('{SEQ}', seqStr)
    .replaceAll('{INITIALS}', initials ?? '')
    .replaceAll('{MMMM}', mmmm)
    .replaceAll('{MMM}', mmm)
    .replaceAll('{MM}', mm)
    .replaceAll('{YYYY}', yyyy)
    .replaceAll('{YY}', yy)
    .replaceAll('{DD}', dd);
}

export function voucherTotal(v: Voucher): number {
  return v.lines.reduce((sum, l) => sum + l.amount, 0);
}
