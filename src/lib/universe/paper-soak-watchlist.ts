/**
 * Configurable paper-soak candidate watchlist.
 * Symbols are validated dynamically each scan — this is not a permanent hard allowlist.
 * Prefer liquid U.S. equities that often trade in the $5–$50 universe band.
 */

import { filterUsStockSymbols, isBlockedNonStockSymbol } from "@/lib/stocks/universe";
import { isLeveragedOrInverseEtf } from "@/lib/universe/leveraged-etfs";

/**
 * Default soak candidates (20–30+). Prices move — universe filters re-check every scan.
 * Diversified across banks, telecom, autos, travel, energy MLPs, ADRs, fintech.
 */
export const DEFAULT_PAPER_SOAK_WATCHLIST: readonly string[] = [
  "F",
  "BAC",
  "T",
  "VZ",
  "PFE",
  "INTC",
  "SOFI",
  "NIO",
  "SNAP",
  "WBD",
  "AAL",
  "CCL",
  "KEY",
  "RF",
  "HBAN",
  "ET",
  "KMI",
  "MO",
  "VALE",
  "ITUB",
  "NOK",
  "ERIC",
  "GRAB",
  "RIVN",
  "HOOD",
  "NU",
  "DKNG",
  "MARA",
  "UBER",
  "PLTR",
] as const;

export type StaticWatchlistCheck = {
  symbol: string;
  ok: boolean;
  reasons: string[];
};

/** Deduplicate and normalize a raw comma-separated or array watchlist. */
export function parseConfigurableWatchlist(
  raw: string | undefined | null,
  fallback: readonly string[],
): string[] {
  const source =
    raw != null && raw.trim() !== ""
      ? raw.split(",")
      : [...fallback];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of source) {
    const symbol = part.trim().toUpperCase();
    if (!symbol) continue;
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }

  const stocks = filterUsStockSymbols(out);
  return stocks.length > 0 ? stocks : filterUsStockSymbols([...fallback]);
}

/**
 * Static eligibility (no quotes): format, blocked non-stocks, leveraged/inverse ETFs.
 */
export function evaluateStaticWatchlistEligibility(
  symbols: string[],
): {
  passed: string[];
  rejected: StaticWatchlistCheck[];
} {
  const passed: string[] = [];
  const rejected: StaticWatchlistCheck[] = [];
  const seen = new Set<string>();

  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase();
    const reasons: string[] = [];
    if (!symbol || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) {
      reasons.push("Invalid symbol format");
    }
    if (seen.has(symbol)) {
      reasons.push("Duplicate symbol");
    }
    if (isBlockedNonStockSymbol(symbol)) {
      reasons.push("Unsupported or non-equity symbol");
    }
    if (isLeveragedOrInverseEtf(symbol)) {
      reasons.push("Leveraged or inverse ETF excluded");
    }
    if (reasons.length > 0) {
      rejected.push({ symbol: symbol || raw, ok: false, reasons });
      continue;
    }
    seen.add(symbol);
    passed.push(symbol);
  }

  return { passed, rejected };
}

export function getPaperSoakWatchlist(): string[] {
  return parseConfigurableWatchlist(
    process.env.PAPER_SOAK_WATCHLIST ?? process.env.SOAK_WATCHLIST,
    DEFAULT_PAPER_SOAK_WATCHLIST,
  );
}
