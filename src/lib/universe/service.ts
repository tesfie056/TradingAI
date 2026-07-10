/**
 * Configurable stock-universe service for paper auto-trading.
 * Starts from watchlist (soak or WATCHLIST), applies hard filters every scan.
 * Never places orders.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getLatestQuotes,
  getRecentBars,
  lookupUsEquityAsset,
} from "@/lib/alpaca/client";
import type { AlpacaBar, AlpacaQuote } from "@/lib/alpaca/types";
import { getWatchlist } from "@/lib/config";
import { getEffectiveRuntimeSettings } from "@/lib/auto-trade/runtime-settings/service";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import {
  evaluateUniverseEligibility,
  type UniverseFilterResult,
} from "@/lib/universe/filters";
import { filterUsStockSymbols } from "@/lib/stocks/universe";
import { evaluateStaticWatchlistEligibility } from "@/lib/universe/paper-soak-watchlist";

const DIR = path.join(process.cwd(), "data");
const SNAPSHOT_FILE = path.join(DIR, "universe-snapshot.json");

export type UniverseSymbolSnapshot = {
  symbol: string;
  price: number | null;
  spreadPercent: number | null;
  avgDailyVolume: number | null;
  eligible: boolean;
  reasons: string[];
  assetStatus: string | null;
  tradable: boolean | null;
  shortable: boolean | null;
};

export type UniverseFilterBreakdown = {
  watchlistSize: number;
  staticPassed: number;
  staticRejected: number;
  rejectedByPrice: number;
  rejectedByLiquidity: number;
  rejectedBySpread: number;
  rejectedOther: number;
  eligibleCount: number;
  eligibleSymbols: string[];
};

export type UniverseScanResult = {
  paperOnly: true;
  watchlist: string[];
  scanned: UniverseSymbolSnapshot[];
  eligibleSymbols: string[];
  rejected: UniverseFilterResult[];
  breakdown: UniverseFilterBreakdown;
  warnings: string[];
  /** When true, scanner must not fall back to the raw watchlist. */
  blockScanOnEmpty: boolean;
};

function midFromQuote(q: AlpacaQuote | undefined): number | null {
  if (!q) return null;
  const bid = q.bid ?? 0;
  const ask = q.ask ?? 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (ask > 0) return ask;
  if (bid > 0) return bid;
  return null;
}

function spreadFromQuote(q: AlpacaQuote | undefined): number | null {
  if (!q) return null;
  const bid = q.bid ?? 0;
  const ask = q.ask ?? 0;
  if (bid <= 0 || ask <= 0) return null;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;
  return (ask - bid) / mid;
}

function avgVolumeFromBars(bars: AlpacaBar[] | undefined): number | null {
  if (!bars || bars.length === 0) return null;
  const vols = bars.map((b) => b.v).filter((v) => Number.isFinite(v) && v >= 0);
  if (vols.length === 0) return null;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

function classifyRejection(reasons: string[]): {
  price: boolean;
  liquidity: boolean;
  spread: boolean;
  other: boolean;
} {
  let price = false;
  let liquidity = false;
  let spread = false;
  let other = false;
  for (const r of reasons) {
    if (/price|penny|below minimum|above maximum/i.test(r)) price = true;
    else if (/ADV|volume/i.test(r)) liquidity = true;
    else if (/spread/i.test(r)) spread = true;
    else other = true;
  }
  if (!price && !liquidity && !spread && reasons.length > 0) other = true;
  return { price, liquidity, spread, other };
}

export function buildUniverseWarnings(input: {
  watchlist: string[];
  staticPassed: number;
  eligibleCount: number;
  scanned: UniverseSymbolSnapshot[];
  minEligibleSoft: number;
  minPrice?: number;
  maxPrice?: number;
}): string[] {
  const warnings: string[] = [];
  const { watchlist, staticPassed, eligibleCount, scanned, minEligibleSoft } =
    input;
  const cfg = getRiskTradingConfig();
  const minPrice = input.minPrice ?? cfg.minPrice;
  const maxPrice = input.maxPrice ?? cfg.maxPrice;

  if (watchlist.length === 0) {
    warnings.push("Watchlist is empty — no symbols to scan");
  }

  if (watchlist.length > 0 && staticPassed === 0) {
    warnings.push(
      "Zero symbols passed static eligibility checks (format / ETF / unsupported)",
    );
  }

  const withPrice = scanned.filter(
    (s) => s.price != null && Number.isFinite(s.price),
  );
  if (withPrice.length > 0) {
    const allPriceOutOfBand = withPrice.every((s) => {
      const p = s.price!;
      return p < minPrice || p > maxPrice;
    });
    if (allPriceOutOfBand) {
      warnings.push(
        `Entire watchlist is outside the allowed $${minPrice}–$${maxPrice} price range`,
      );
    }
  }

  if (eligibleCount === 0) {
    warnings.push(
      "Zero symbols eligible after universe filters — scanner will not trade or fall back to raw watchlist",
    );
  } else if (eligibleCount < minEligibleSoft) {
    warnings.push(
      `Fewer than ${minEligibleSoft} symbols remain eligible (${eligibleCount})`,
    );
  }

  return warnings;
}

/**
 * Resolve eligible symbols from the configured watchlist.
 * Always re-validates dynamically (quotes, ADV, spread, asset status).
 */
export async function resolveEligibleUniverse(options?: {
  symbols?: string[];
  requiresShorting?: boolean;
}): Promise<UniverseScanResult> {
  const rawWatchlist = filterUsStockSymbols(
    options?.symbols ?? getWatchlist(),
  );
  // Deduplicate again for safety
  const watchlist = [...new Set(rawWatchlist.map((s) => s.toUpperCase()))];
  const requiresShorting = options?.requiresShorting ?? false;

  const staticCheck = evaluateStaticWatchlistEligibility(watchlist);
  const candidates = staticCheck.passed;

  if (watchlist.length === 0 || candidates.length === 0) {
    const breakdown: UniverseFilterBreakdown = {
      watchlistSize: watchlist.length,
      staticPassed: 0,
      staticRejected: staticCheck.rejected.length,
      rejectedByPrice: 0,
      rejectedByLiquidity: 0,
      rejectedBySpread: 0,
      rejectedOther: staticCheck.rejected.length,
      eligibleCount: 0,
      eligibleSymbols: [],
    };
    const warnings = buildUniverseWarnings({
      watchlist,
      staticPassed: 0,
      eligibleCount: 0,
      scanned: [],
      minEligibleSoft: getEffectiveRuntimeSettings().minEligibleSymbols,
    });
    const result: UniverseScanResult = {
      paperOnly: true,
      watchlist,
      scanned: [],
      eligibleSymbols: [],
      rejected: staticCheck.rejected.map((r) => ({
        symbol: r.symbol,
        eligible: false,
        reasons: r.reasons,
      })),
      breakdown,
      warnings,
      blockScanOnEmpty: true,
    };
    await persistUniverseSnapshot(result).catch(() => undefined);
    return result;
  }

  const [quotes, barsBySymbol] = await Promise.all([
    getLatestQuotes(candidates).catch(() => [] as AlpacaQuote[]),
    getRecentBars(candidates, "1Day", 20).catch(
      () => ({} as Record<string, AlpacaBar[]>),
    ),
  ]);

  const quoteMap = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  const assets = await Promise.all(
    candidates.map(async (symbol) => {
      const asset = await lookupUsEquityAsset(symbol).catch(() => null);
      return [symbol, asset] as const;
    }),
  );
  const assetMap = new Map(assets);

  const scanned: UniverseSymbolSnapshot[] = [];
  const rejected: UniverseFilterResult[] = [
    ...staticCheck.rejected.map((r) => ({
      symbol: r.symbol,
      eligible: false,
      reasons: r.reasons,
    })),
  ];
  const eligibleSymbols: string[] = [];
  let rejectedByPrice = 0;
  let rejectedByLiquidity = 0;
  let rejectedBySpread = 0;
  let rejectedOther = staticCheck.rejected.length;

  for (const symbol of candidates) {
    const quote = quoteMap.get(symbol);
    const asset = assetMap.get(symbol) ?? null;
    const price = midFromQuote(quote);
    const spreadPercent = spreadFromQuote(quote);
    const avgDailyVolume = avgVolumeFromBars(barsBySymbol[symbol]);

    const filter = evaluateUniverseEligibility({
      symbol,
      price,
      spreadPercent,
      avgDailyVolume,
      assetStatus: asset?.status ?? null,
      tradable: asset?.tradable ?? null,
      assetClass: asset?.class ?? null,
      shortable: asset?.shortable ?? null,
      requiresShorting,
    });

    const row: UniverseSymbolSnapshot = {
      symbol,
      price,
      spreadPercent,
      avgDailyVolume,
      eligible: filter.eligible,
      reasons: filter.reasons,
      assetStatus: asset?.status ?? null,
      tradable: asset?.tradable ?? null,
      shortable: asset?.shortable ?? null,
    };
    scanned.push(row);
    if (filter.eligible) {
      eligibleSymbols.push(symbol);
    } else {
      rejected.push(filter);
      const c = classifyRejection(filter.reasons);
      if (c.price) rejectedByPrice += 1;
      if (c.liquidity) rejectedByLiquidity += 1;
      if (c.spread) rejectedBySpread += 1;
      if (c.other) rejectedOther += 1;
    }
  }

  const breakdown: UniverseFilterBreakdown = {
    watchlistSize: watchlist.length,
    staticPassed: candidates.length,
    staticRejected: staticCheck.rejected.length,
    rejectedByPrice,
    rejectedByLiquidity,
    rejectedBySpread,
    rejectedOther,
    eligibleCount: eligibleSymbols.length,
    eligibleSymbols: [...eligibleSymbols],
  };

  const warnings = buildUniverseWarnings({
    watchlist,
    staticPassed: candidates.length,
    eligibleCount: eligibleSymbols.length,
    scanned,
    minEligibleSoft: getEffectiveRuntimeSettings().minEligibleSymbols,
  });

  const result: UniverseScanResult = {
    paperOnly: true,
    watchlist,
    scanned,
    eligibleSymbols,
    rejected,
    breakdown,
    warnings,
    blockScanOnEmpty: true,
  };
  await persistUniverseSnapshot(result).catch(() => undefined);
  return result;
}

export type UniverseDashboardSnapshot = {
  paperOnly: true;
  updatedAt: string;
  watchlistSize: number;
  staticPassed: number;
  rejectedByPrice: number;
  rejectedByLiquidity: number;
  rejectedBySpread: number;
  eligibleCount: number;
  eligibleSymbols: string[];
  warnings: string[];
};

async function persistUniverseSnapshot(
  result: UniverseScanResult,
): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const snap: UniverseDashboardSnapshot = {
    paperOnly: true,
    updatedAt: new Date().toISOString(),
    watchlistSize: result.breakdown.watchlistSize,
    staticPassed: result.breakdown.staticPassed,
    rejectedByPrice: result.breakdown.rejectedByPrice,
    rejectedByLiquidity: result.breakdown.rejectedByLiquidity,
    rejectedBySpread: result.breakdown.rejectedBySpread,
    eligibleCount: result.breakdown.eligibleCount,
    eligibleSymbols: result.breakdown.eligibleSymbols,
    warnings: result.warnings,
  };
  await writeFile(SNAPSHOT_FILE, `${JSON.stringify(snap, null, 2)}\n`, "utf8");
}

export async function readUniverseSnapshot(): Promise<UniverseDashboardSnapshot | null> {
  try {
    const raw = await readFile(SNAPSHOT_FILE, "utf8");
    const parsed = JSON.parse(raw) as UniverseDashboardSnapshot;
    if (parsed?.paperOnly !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Log universe warnings at startup / after resolve (never throws). */
export function logUniverseWarnings(warnings: string[]): void {
  for (const w of warnings) {
    console.warn(`[universe] ${w}`);
  }
}
