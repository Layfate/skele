import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/** Fractional-index ranks: ordering an item between two neighbours touches only that item. */
export function rankBetween(before: string | null | undefined, after: string | null | undefined): string {
  // Guard against inverted neighbours (stale client data) instead of throwing.
  if (before && after && before >= after) return generateKeyBetween(before, null);
  return generateKeyBetween(before ?? null, after ?? null);
}

export function rankAfter(last: string | null | undefined): string {
  return generateKeyBetween(last ?? null, null);
}

export function rankBefore(first: string | null | undefined): string {
  return generateKeyBetween(null, first ?? null);
}

export function ranksAfter(last: string | null | undefined, n: number): string[] {
  return generateNKeysBetween(last ?? null, null, n);
}
