export const FEE_BPS = 1000;
export const MAX_PRICE_CENTS = 1_000_000;
export const TOKEN_DECIMALS = 6;

export function feeCents(amountCents: number): number {
  return Math.floor((amountCents * FEE_BPS) / 10_000);
}

export function sellerNetCents(amountCents: number): number {
  return amountCents - feeCents(amountCents);
}

export function centsToBaseUnits(cents: number): bigint {
  return BigInt(Math.round(cents)) * 10_000n;
}

export function baseUnitsToCents(baseUnits: bigint | number | string): number {
  return Number(BigInt(baseUnits) / 10_000n);
}

export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  const hasCents = cents % 100 !== 0;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
