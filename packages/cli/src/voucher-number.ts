import type { Config } from '@invoice/shared';

export interface VoucherNumberSpec {
  format: string;
  seq: number;
  initials: string;
}

/** Uppercased first letter of each word in the name ("Joy Poddar" → "JP"). */
export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export function resolveVoucherNumberSpec(config: Config): VoucherNumberSpec {
  return {
    format: config.voucher.numberFormat,
    seq: config.voucher.nextSeq,
    initials: initialsFor(config.name),
  };
}
