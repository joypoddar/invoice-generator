/**
 * Spell out a monetary amount, e.g. 186 → "Rupees One hundred and eighty six
 * only." Uses the Indian numbering system (crore/lakh) since INR is the primary
 * currency. Fractional minor units are appended ("… and fifty paise only.").
 * Sentence-cased to match the reference voucher design.
 */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

interface CurrencyWords {
  major: string;
  minor: string;
}

const CURRENCY_WORDS: Record<string, CurrencyWords> = {
  INR: { major: 'Rupees', minor: 'paise' },
  USD: { major: 'Dollars', minor: 'cents' },
  EUR: { major: 'Euros', minor: 'cents' },
  GBP: { major: 'Pounds', minor: 'pence' },
};

function below100(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]} ${ONES[o]}` : (TENS[t] ?? '');
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const hWord = ONES[h] ?? '';
  if (h && rem) return `${hWord} hundred and ${below100(rem)}`;
  if (h) return `${hWord} hundred`;
  return below100(rem);
}

function intToWords(n: number): string {
  if (n === 0) return 'zero';
  const crore = Math.floor(n / 10000000);
  let rest = n % 10000000;
  const lakh = Math.floor(rest / 100000);
  rest %= 100000;
  const thousand = Math.floor(rest / 1000);
  const hundred = rest % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${intToWords(crore)} crore`);
  if (lakh) parts.push(`${below100(lakh)} lakh`);
  if (thousand) parts.push(`${below100(thousand)} thousand`);
  if (hundred) parts.push(below1000(hundred));
  return parts.join(' ');
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function amountToWords(amount: number, currency: string): string {
  const words = CURRENCY_WORDS[currency.toUpperCase()] ?? {
    major: currency.toUpperCase(),
    minor: 'cents',
  };
  const totalMinor = Math.round(Math.abs(amount) * 100);
  const major = Math.floor(totalMinor / 100);
  const minor = totalMinor % 100;

  let phrase = `${words.major} ${capitalize(intToWords(major))}`;
  if (minor > 0) phrase += ` and ${below100(minor)} ${words.minor}`;
  return `${phrase} only.`;
}
