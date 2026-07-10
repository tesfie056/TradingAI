/**
 * Hard filters for the paper-trading stock universe.
 * Pure functions — no broker calls. Never places orders.
 */

import { getRiskTradingConfig } from "@/lib/config/risk-config";
import { isLeveragedOrInverseEtf } from "@/lib/universe/leveraged-etfs";
import { isBlockedNonStockSymbol } from "@/lib/stocks/universe";

export type UniverseFilterInput = {
  symbol: string;
  price: number | null;
  spreadPercent: number | null;
  avgDailyVolume: number | null;
  /** Alpaca asset status e.g. active */
  assetStatus?: string | null;
  tradable?: boolean | null;
  assetClass?: string | null;
  shortable?: boolean | null;
  /** When true, non-shortable symbols are rejected. */
  requiresShorting?: boolean;
  /** Override config for tests. */
  config?: Partial<ReturnType<typeof getRiskTradingConfig>>;
};

export type UniverseFilterResult = {
  symbol: string;
  eligible: boolean;
  reasons: string[];
};

/**
 * Apply hard universe filters. Spread is percent of mid (0.005 = 0.5%).
 * Config maxSpreadPercent is in percent points (0.5 = 0.5%).
 */
export function evaluateUniverseEligibility(
  input: UniverseFilterInput,
): UniverseFilterResult {
  const cfg = { ...getRiskTradingConfig(), ...input.config };
  const symbol = input.symbol.trim().toUpperCase();
  const reasons: string[] = [];

  if (!symbol || isBlockedNonStockSymbol(symbol)) {
    reasons.push("Not a tradable U.S. stock symbol");
  }

  if (cfg.excludeLeveragedInverseEtfs && isLeveragedOrInverseEtf(symbol)) {
    reasons.push("Leveraged or inverse ETF excluded");
  }

  if (input.price == null || !Number.isFinite(input.price)) {
    reasons.push("Price unavailable");
  } else {
    if (input.price < cfg.minPrice) {
      reasons.push(
        `Price $${input.price.toFixed(2)} below minimum $${cfg.minPrice}`,
      );
    }
    if (input.price > cfg.maxPrice) {
      reasons.push(
        `Price $${input.price.toFixed(2)} above maximum $${cfg.maxPrice}`,
      );
    }
    if (input.price < 5) {
      reasons.push("Penny stock below $5 excluded");
    }
  }

  if (input.avgDailyVolume == null || !Number.isFinite(input.avgDailyVolume)) {
    reasons.push("Average daily volume unavailable");
  } else if (input.avgDailyVolume < cfg.minAvgDailyVolume) {
    reasons.push(
      `ADV ${Math.floor(input.avgDailyVolume)} below ${cfg.minAvgDailyVolume}`,
    );
  }

  const maxSpreadFrac = cfg.maxSpreadPercent / 100;
  if (input.spreadPercent == null || !Number.isFinite(input.spreadPercent)) {
    reasons.push("Bid/ask spread unavailable");
  } else if (input.spreadPercent > maxSpreadFrac) {
    reasons.push(
      `Spread ${(input.spreadPercent * 100).toFixed(2)}% above max ${cfg.maxSpreadPercent}%`,
    );
  }

  if (input.tradable === false) {
    reasons.push("Symbol not tradable through Alpaca");
  }
  if (input.assetClass != null && input.assetClass !== "us_equity") {
    reasons.push("Asset class is not us_equity");
  }
  const status = (input.assetStatus ?? "").toLowerCase();
  if (status && status !== "active") {
    reasons.push(`Asset status is ${input.assetStatus} (not active)`);
  }

  if (
    input.requiresShorting &&
    cfg.requireShortableWhenShorting &&
    input.shortable === false
  ) {
    reasons.push("Symbol is not shortable (required by strategy)");
  }

  return {
    symbol,
    eligible: reasons.length === 0,
    reasons,
  };
}

export function filterUniverseCandidates(
  inputs: UniverseFilterInput[],
): { eligible: UniverseFilterResult[]; rejected: UniverseFilterResult[] } {
  const eligible: UniverseFilterResult[] = [];
  const rejected: UniverseFilterResult[] = [];
  for (const input of inputs) {
    const result = evaluateUniverseEligibility(input);
    if (result.eligible) eligible.push(result);
    else rejected.push(result);
  }
  return { eligible, rejected };
}
