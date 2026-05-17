/**
 * Date and currency formatting helpers used by the HTML invoice renderer.
 * Date inputs are ISO `YYYY-MM-DD` strings (or full ISO timestamps); currency
 * inputs are plain numbers. Both are configurable via `config.invoice.*`.
 */

export type DateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD-MM-YYYY';

export const DEFAULT_DATE_FORMAT: DateFormat = 'DD/MM/YYYY';

export function formatDate(iso: string | undefined, format: string = DEFAULT_DATE_FORMAT): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  switch (format) {
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'DD-MM-YYYY':
      return `${dd}-${mm}-${yyyy}`;
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

/** Format a percentage (0.18 → "18%"). */
export function formatPercent(rate: number): string {
  const pct = rate * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}
