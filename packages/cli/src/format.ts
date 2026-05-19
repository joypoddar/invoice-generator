/**
 * Date and currency formatting helpers used by the HTML invoice renderer.
 * Date inputs are ISO `YYYY-MM-DD` strings (or full ISO timestamps); currency
 * inputs are plain numbers. Both are configurable via `config.invoice.*`.
 */

export type DateFormat =
  | 'YYYY-MM-DD'
  | 'ISO8601' // alias for YYYY-MM-DD
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'DD-MM-YYYY'
  | 'MMM DD, YYYY' // e.g. "Mar 28, 2026"
  | 'MMMM DD, YYYY' // e.g. "March 28, 2026"
  | 'DD MMM YYYY'; // e.g. "28 Mar 2026"

export const DEFAULT_DATE_FORMAT: DateFormat = 'DD/MM/YYYY';

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

export function formatDate(iso: string | undefined, format: string = DEFAULT_DATE_FORMAT): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = String(d.getFullYear());
  const mi = d.getMonth(); // 0-based
  const mm = String(mi + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dNum = String(d.getDate());
  const mmm = SHORT_MONTHS[mi];
  const mmmm = LONG_MONTHS[mi];
  switch (format) {
    case 'YYYY-MM-DD':
    case 'ISO8601':
      return `${yyyy}-${mm}-${dd}`;
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'DD-MM-YYYY':
      return `${dd}-${mm}-${yyyy}`;
    case 'MMM DD, YYYY':
      return `${mmm} ${dNum}, ${yyyy}`;
    case 'MMMM DD, YYYY':
      return `${mmmm} ${dNum}, ${yyyy}`;
    case 'DD MMM YYYY':
      return `${dNum} ${mmm} ${yyyy}`;
    case 'DD/MM/YYYY':
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/**
 * Format a number with locale-appropriate grouping. Currency 'INR' produces
 * Indian comma-grouping (`₹12,34,567.89`); everything else uses en-US grouping
 * with the appropriate symbol or ISO code prefix.
 */
export function formatCurrency(amount: number, currency: string): string {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback when the currency code isn't recognized by Intl
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Like formatCurrency but drops trailing `.00` when the amount is a whole
 * number. Useful for the "Rate" column where invoices typically show whole
 * amounts (`₹55,000`) but switch to `₹55,000.50` if a fraction exists.
 */
export function formatCurrencyMaybeInt(amount: number, currency: string): string {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const isWhole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return isWhole ? `${currency} ${amount}` : `${currency} ${amount.toFixed(2)}`;
  }
}

/** Format a percentage (0.18 → "18%"). */
export function formatPercent(rate: number): string {
  const pct = rate * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}
