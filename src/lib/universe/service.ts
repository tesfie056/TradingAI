/**
 * Configurable stock-universe service for paper auto-trading.
 * Starts from watchlist (V1 default, soak, or custom), applies hard filters every scan.
 * Never places orders.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getLatestQuotes,
  getMarketClock,
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
import { toUserFacingUniverseReasons } from "@/lib/universe/user-reasons";
import { isQuoteStale } from "@/lib/market/data-quality";

const DIR = path.join(process.cwd(), "data");
const SNAPSHOT_FILE = path.join(DIR, "universe-snapshot.json");

export type UniverseSymbolSnapshot = {
  symbol: string;
  name: string | null;
  price: number | null;
  bid: number | null;
  ask: number | null;
  spreadPercent: number | null;
  avgDailyVolume: number | null;
  eligible: boolean;
  reasons: string[];
  userReasons: string[];
  assetStatus: string | null;
  tradable: boolean | null;
  shortable: boolean | null;
  fractionable: boolean | null;
  quoteTimestamp: string | null;
  quoteStale: boolean | null;
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
  ineligibleCount: number;
  eligibleSymbols: string[];
  ineligibleSymbols: string[];
};

export type UniverseFilterConfigSnapshot = {
  minPrice: number;
  maxPrice: number;
  minAvgDailyVolume: number;
  maxSpreadPercent: number;
  excludeLeveragedInverseEtfs: boolean;
  minEligibleSymbols: number;
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
  evaluatedAt: string;
  marketOpen: boolean | null;
  dataFreshness: "fresh" | "stale" | "unavailable" | "after_hours";
  filterConfig: UniverseFilterConfigSnapshot;
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

function avgVolumeFromBars(
  bars: AlpacaBar[] | undefined,
  options?: { excludeIncompleteLastBar?: boolean },
): number | null {
  if (!bars || bars.length === 0) return null;
  let use = bars.filter((b) => Number.isFinite(b.v) && b.v >= 0);
  if (options?.excludeIncompleteLastBar && use.length > 1) {
    // Today's 1Day bar is incomplete during RTH and understates ADV.
    use = use.slice(0, -1);
  }
  if (use.length === 0) return null;
  return use.reduce((a, b) => a + b.v, 0) / use.length;
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

function activeFilterConfig(): UniverseFilterConfigSnapshot {
  const cfg = getRiskTradingConfig();
  const settings = getEffectiveRuntimeSettings();
  return {
    minPrice: cfg.minPrice,
    maxPrice: cfg.maxPrice,
    minAvgDailyVolume: cfg.minAvgDailyVolume,
    maxSpreadPercent: cfg.maxSpreadPercent,
    excludeLeveragedInverseEtfs: cfg.excludeLeveragedInverseEtfs,
    minEligibleSymbols: settings.minEligibleSymbols,
  };
}

export function buildUniverseWarnings(input: {
  watchlist: string[];
  staticPassed: number;
  eligibleCount: number;
  scanned: UniverseSymbolSnapshot[];
  minEligibleSoft: number;
  minPrice?: number;
  maxPrice?: number;
  marketOpen?: boolean | null;
  dataFreshness?: UniverseScanResult["dataFreshness"];
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

  if (input.marketOpen === false) {
    warnings.push(
      "Market is closed — after-hours quotes/spreads may look worse than regular-session conditions",
    );
  }
  if (input.dataFreshness === "stale") {
    warnings.push("Some market data quotes are stale");
  }
  if (input.dataFreshness === "unavailable") {
    warnings.push("Market data was unavailable for one or more symbols");
  }

  return warnings;
}

/**
 * Resolve eligible symbols from the configured watchlist.
 * Always re-validates dynamically (quotes, ADV, spread, asset status).
 * Never places, cancels, or modifies orders/positions.
 */
export async function resolveEligibleUniverse(options?: {
  symbols?: string[];
  requiresShorting?: boolean;
}): Promise<UniverseScanResult> {
  const evaluatedAt = new Date().toISOString();
  const filterConfig = activeFilterConfig();
  const rawWatchlist = filterUsStockSymbols(
    options?.symbols ?? getWatchlist(),
  );
  const watchlist = [...new Set(rawWatchlist.map((s) => s.toUpperCase()))];
  const requiresShorting = options?.requiresShorting ?? false;

  let marketOpen: boolean | null = null;
  try {
    const clock = await getMarketClock();
    marketOpen = clock.isOpen;
  } catch {
    marketOpen = null;
  }

  const staticCheck = evaluateStaticWatchlistEligibility(watchlist);
  const candidates = staticCheck.passed;

  const emptyResult = (
    scanned: UniverseSymbolSnapshot[],
    rejected: UniverseFilterResult[],
    breakdown: UniverseFilterBreakdown,
    dataFreshness: UniverseScanResult["dataFreshness"],
  ): UniverseScanResult => {
    const warnings = buildUniverseWarnings({
      watchlist,
      staticPassed: breakdown.staticPassed,
      eligibleCount: breakdown.eligibleCount,
      scanned,
      minEligibleSoft: filterConfig.minEligibleSymbols,
      minPrice: filterConfig.minPrice,
      maxPrice: filterConfig.maxPrice,
      marketOpen,
      dataFreshness,
    });
    return {
      paperOnly: true,
      watchlist,
      scanned,
      eligibleSymbols: breakdown.eligibleSymbols,
      rejected,
      breakdown,
      warnings,
      blockScanOnEmpty: true,
      evaluatedAt,
      marketOpen,
      dataFreshness,
      filterConfig,
    };
  };

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
      ineligibleCount: staticCheck.rejected.length,
      eligibleSymbols: [],
      ineligibleSymbols: staticCheck.rejected.map((r) => r.symbol),
    };
    const result = emptyResult(
      [],
      staticCheck.rejected.map((r) => ({
        symbol: r.symbol,
        eligible: false,
        reasons: r.reasons,
      })),
      breakdown,
      "unavailable",
    );
    await persistUniverseSnapshot(result).catch(() => undefined);
    return result;
  }

  const quoteChunks: string[][] = [];
  const barChunks: string[][] = [];
  const CHUNK = 10;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    quoteChunks.push(candidates.slice(i, i + CHUNK));
    barChunks.push(candidates.slice(i, i + CHUNK));
  }

  const quoteLists = await Promise.all(
    quoteChunks.map((chunk) =>
      getLatestQuotes(chunk).catch(() => [] as AlpacaQuote[]),
    ),
  );
  const quotes = quoteLists.flat();

  const barsBySymbol: Record<string, AlpacaBar[]> = {};
  for (const chunk of barChunks) {
    const part = await getRecentBars(chunk, "1Day", 20).catch(
      () => ({} as Record<string, AlpacaBar[]>),
    );
    Object.assign(barsBySymbol, part);
  }

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
  const ineligibleSymbols: string[] = staticCheck.rejected.map((r) => r.symbol);
  let rejectedByPrice = 0;
  let rejectedByLiquidity = 0;
  let rejectedBySpread = 0;
  let rejectedOther = staticCheck.rejected.length;
  let anyQuote = false;
  let anyStale = false;
  let anyMissingQuote = false;

  for (const symbol of candidates) {
    const quote = quoteMap.get(symbol);
    const asset = assetMap.get(symbol) ?? null;
    const price = midFromQuote(quote);
    const spreadPercent = spreadFromQuote(quote);
    const avgDailyVolume = avgVolumeFromBars(barsBySymbol[symbol], {
      excludeIncompleteLastBar: marketOpen === true,
    });
    const quoteTimestamp = quote?.timestamp ?? null;
    const quoteStale =
      quoteTimestamp != null
        ? isQuoteStale(quoteTimestamp, marketOpen === true)
        : null;

    if (quote) anyQuote = true;
    else anyMissingQuote = true;
    if (quoteStale === true) anyStale = true;

    const reasonsExtra: string[] = [];
    if (!quote) {
      reasonsExtra.push("Current quote is unavailable");
    } else if (quoteStale === true && marketOpen === true) {
      reasonsExtra.push("Market data is stale");
    }

    const filter = evaluateUniverseEligibility({
      symbol,
      price,
      spreadPercent,
      avgDailyVolume,
      assetStatus: asset?.status ?? null,
      tradable: asset?.tradable ?? null,
      assetClass: asset?.class ?? null,
      shortable: asset?.shortable ?? null,
      fractionable: asset ? asset.fractionable : null,
      assetLookupFailed: asset == null,
      requiresShorting,
    });

    const reasons = [...new Set([...filter.reasons, ...reasonsExtra])];
    // If we only added stale/unavailable extras, recompute eligibility
    const eligible = reasons.length === 0;

    const row: UniverseSymbolSnapshot = {
      symbol,
      name: asset?.name ?? null,
      price,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      spreadPercent,
      avgDailyVolume,
      eligible,
      reasons,
      userReasons: toUserFacingUniverseReasons(reasons),
      assetStatus: asset?.status ?? null,
      tradable: asset?.tradable ?? null,
      shortable: asset?.shortable ?? null,
      fractionable: asset?.fractionable ?? null,
      quoteTimestamp,
      quoteStale,
    };
    scanned.push(row);
    if (eligible) {
      eligibleSymbols.push(symbol);
    } else {
      rejected.push({ symbol, eligible: false, reasons });
      ineligibleSymbols.push(symbol);
      const c = classifyRejection(reasons);
      if (c.price) rejectedByPrice += 1;
      if (c.liquidity) rejectedByLiquidity += 1;
      if (c.spread) rejectedBySpread += 1;
      if (c.other) rejectedOther += 1;
    }
  }

  const dataFreshness: UniverseScanResult["dataFreshness"] = !anyQuote
    ? "unavailable"
    : marketOpen === false
      ? "after_hours"
      : anyStale
        ? "stale"
        : anyMissingQuote
          ? "unavailable"
          : "fresh";

  const breakdown: UniverseFilterBreakdown = {
    watchlistSize: watchlist.length,
    staticPassed: candidates.length,
    staticRejected: staticCheck.rejected.length,
    rejectedByPrice,
    rejectedByLiquidity,
    rejectedBySpread,
    rejectedOther,
    eligibleCount: eligibleSymbols.length,
    ineligibleCount: ineligibleSymbols.length,
    eligibleSymbols: [...eligibleSymbols],
    ineligibleSymbols: [...ineligibleSymbols],
  };

  const result: UniverseScanResult = {
    paperOnly: true,
    watchlist,
    scanned,
    eligibleSymbols,
    rejected,
    breakdown,
    warnings: buildUniverseWarnings({
      watchlist,
      staticPassed: candidates.length,
      eligibleCount: eligibleSymbols.length,
      scanned,
      minEligibleSoft: filterConfig.minEligibleSymbols,
      minPrice: filterConfig.minPrice,
      maxPrice: filterConfig.maxPrice,
      marketOpen,
      dataFreshness,
    }),
    blockScanOnEmpty: true,
    evaluatedAt,
    marketOpen,
    dataFreshness,
    filterConfig,
  };
  await persistUniverseSnapshot(result).catch(() => undefined);
  return result;
}

export type UniverseDashboardSymbol = {
  symbol: string;
  name: string | null;
  status: "eligible" | "ineligible";
  price: number | null;
  userReason: string | null;
};

export type UniverseDashboardSnapshot = {
  paperOnly: true;
  updatedAt: string;
  evaluatedAt: string;
  watchlistSize: number;
  configuredSymbols: string[];
  staticPassed: number;
  rejectedByPrice: number;
  rejectedByLiquidity: number;
  rejectedBySpread: number;
  eligibleCount: number;
  ineligibleCount: number;
  eligibleSymbols: string[];
  ineligibleSymbols: string[];
  symbols: UniverseDashboardSymbol[];
  warnings: string[];
  marketOpen: boolean | null;
  dataFreshness: UniverseScanResult["dataFreshness"];
  filterConfig: UniverseFilterConfigSnapshot;
};

async function persistUniverseSnapshot(
  result: UniverseScanResult,
): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const symbols: UniverseDashboardSymbol[] = [
    ...result.scanned.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      status: (s.eligible ? "eligible" : "ineligible") as
        | "eligible"
        | "ineligible",
      price: s.price,
      userReason: s.eligible
        ? null
        : (s.userReasons[0] ?? "Did not meet Version 1 filters"),
    })),
    ...result.rejected
      .filter((r) => !result.scanned.some((s) => s.symbol === r.symbol))
      .map((r) => ({
        symbol: r.symbol,
        name: null as string | null,
        status: "ineligible" as const,
        price: null as number | null,
        userReason: toUserFacingUniverseReasons(r.reasons)[0] ?? null,
      })),
  ];

  const snap: UniverseDashboardSnapshot = {
    paperOnly: true,
    updatedAt: new Date().toISOString(),
    evaluatedAt: result.evaluatedAt,
    watchlistSize: result.breakdown.watchlistSize,
    configuredSymbols: result.watchlist,
    staticPassed: result.breakdown.staticPassed,
    rejectedByPrice: result.breakdown.rejectedByPrice,
    rejectedByLiquidity: result.breakdown.rejectedByLiquidity,
    rejectedBySpread: result.breakdown.rejectedBySpread,
    eligibleCount: result.breakdown.eligibleCount,
    ineligibleCount: result.breakdown.ineligibleCount,
    eligibleSymbols: result.breakdown.eligibleSymbols,
    ineligibleSymbols: result.breakdown.ineligibleSymbols,
    symbols,
    warnings: result.warnings,
    marketOpen: result.marketOpen,
    dataFreshness: result.dataFreshness,
    filterConfig: result.filterConfig,
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
