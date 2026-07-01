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
  /** Send lifecycle. Absent on pre-status-tracking rows; treat as 'draft'. */
  status?: 'draft' | 'sent';
  /** ISO timestamp the voucher was emailed. */
  sentAt?: string;
  /** Snapshot of who it was emailed to. */
  recipients?: { to: string[]; cc?: string[]; bcc?: string[] };
  /** Whether the payout has been disbursed. Absent on old rows; treat as 'unpaid'. */
  paymentStatus?: 'paid' | 'unpaid';
  /** ISO timestamp the payout was marked paid. */
  paidAt?: string;
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

/** Read-time default so pre-status-tracking vouchers report as unpaid. */
export function voucherPaymentStatus(v: Voucher): 'paid' | 'unpaid' {
  return v.paymentStatus ?? 'unpaid';
}

export interface VoucherCloneOverrides {
  id: string;
  voucherNumber: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  createdAt: string;
}

/**
 * Duplicate a voucher as a fresh draft. Payee/customer/lines/company/signatories
 * /notes are preserved; identity (id, number, date) is replaced; send + payment
 * state is reset. Mirrors `prepareClone` for invoices.
 */
export function prepareVoucherClone(source: Voucher, overrides: VoucherCloneOverrides): Voucher {
  return {
    id: overrides.id,
    voucherNumber: overrides.voucherNumber,
    title: source.title,
    payTo: source.payTo,
    ...(source.customerSlug ? { customerSlug: source.customerSlug } : {}),
    date: overrides.date,
    currency: source.currency,
    lines: source.lines.map((l) => ({ ...l })),
    ...(source.companyName ? { companyName: source.companyName } : {}),
    ...(source.companyAddress ? { companyAddress: source.companyAddress } : {}),
    preparedBy: source.preparedBy,
    receivedBy: source.receivedBy,
    ...(source.notes ? { notes: source.notes } : {}),
    createdAt: overrides.createdAt,
    status: 'draft',
    paymentStatus: 'unpaid',
  };
}
