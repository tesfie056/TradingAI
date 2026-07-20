/**
 * Version 1 default paper-trading watchlist.
 * Single source of truth for non-soak defaults (env seed, runtime seed, UI draft).
 *
 * Symbols are re-validated every scan by the universe pipeline — this list is not
 * a permanent hard allowlist. Prefer liquid, established U.S. equities that often
 * trade inside the Version 1 ≈$5–$50 band.
 *
 * Paper soak keeps its own list in paper-soak-watchlist.ts.
 */

import { parseConfigurableWatchlist } from "@/lib/universe/paper-soak-watchlist";

/**
 * Curated Version 1 defaults (12–20). Established U.S. equities across telecom,
 * pharma, media, airlines, tech hardware, energy services, and mid-cap ADRs.
 * Validated against live Alpaca IEX quotes/bars under the ≈$5–$50 universe band.
 * Excludes mega-caps above the price band and highly speculative names.
 */
export const V1_DEFAULT_WATCHLIST: readonly string[] = [
  "F",
  "T",
  "VZ",
  "PFE",
  "WBD",
  "NOK",
  "AAL",
  "CMCSA",
  "HPE",
  "RIG",
  "HBAN",
  "CCL",
  "ITUB",
  "VALE",
  "ERIC",
  "HPQ",
] as const;

/** Mega-cap legacy list — kept only for migration / soak override detection. */
export const LEGACY_MEGA_CAP_WATCHLIST: readonly string[] = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
] as const;

export function getV1DefaultWatchlist(): string[] {
  return parseConfigurableWatchlist(
    process.env.WATCHLIST,
    V1_DEFAULT_WATCHLIST,
  );
}

export function isV1DefaultWatchlist(list: string[]): boolean {
  if (list.length === 0) return true;
  if (list.length !== V1_DEFAULT_WATCHLIST.length) return false;
  const set = new Set(list.map((s) => s.toUpperCase()));
  return (
    V1_DEFAULT_WATCHLIST.every((s) => set.has(s)) &&
    set.size === V1_DEFAULT_WATCHLIST.length
  );
}

export function isLegacyMegaCapWatchlist(list: string[]): boolean {
  if (list.length === 0) return true;
  if (list.length > LEGACY_MEGA_CAP_WATCHLIST.length) return false;
  const set = new Set(list.map((s) => s.toUpperCase()));
  return (
    LEGACY_MEGA_CAP_WATCHLIST.every((s) => set.has(s)) &&
    set.size <= LEGACY_MEGA_CAP_WATCHLIST.length
  );
}

/** True when the list is empty, legacy mega-cap, or the V1 default set. */
export function isDefaultishWatchlist(list: string[]): boolean {
  return (
    list.length === 0 ||
    isLegacyMegaCapWatchlist(list) ||
    isV1DefaultWatchlist(list)
  );
}

export function v1WatchlistCsv(): string {
  return V1_DEFAULT_WATCHLIST.join(",");
}
