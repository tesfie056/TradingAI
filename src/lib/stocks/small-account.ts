/**
 * Small Account Mode — stock filters and scoring helpers.
 * Paper only. Never places orders.
 */

import type { AlpacaBar } from "@/lib/alpaca/types";
import {
  getMaxStockPrice,
  getMinAvgDailyVolume,
  getMinStockPrice,
  getSmallAccountMaxSpreadPercent,
  shouldAvoidOtc,
  type SmallAccountConfig,
} from "@/lib/config";

export type SmallAccountFilters = {
  minPrice: number;
  maxPrice: number;
  minAvgDailyVolume: number;
  maxSpreadPercent: number;
  majorExchangeOnly: boolean;
  avoidOtc: boolean;
};

export type SmallAccountCandidateInput = {
  symbol: string;
  price: number | null;
  spreadPercent: number | null;
  avgDailyVolume: number | null;
  exchange: string | null;
  filters?: Partial<SmallAccountFilters>;
};

export type SmallAccountCandidateResult = {
  symbol: string;
  ok: boolean;
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  price: number | null;
  spreadPercent: number | null;
  avgDailyVolume: number | null;
  exchange: string | null;
};

const MAJOR_EXCHANGES = new Set([
  "NASDAQ",
  "NYSE",
  "ARCA",
  "AMEX",
  "BATS",
  "NYSEARCA",
  "NYSE MKT",
  "NYSEAMERICAN",
]);

export const SMALL_ACCOUNT_WARNINGS = [
  "Low-priced stocks can be more volatile.",
  "Cheap does not mean safer.",
  "Fractional shares may be safer than chasing penny stocks.",
  "Paper trading only — not real money.",
] as const;

export function filtersFromConfig(
  config?: Partial<SmallAccountConfig>,
): SmallAccountFilters {
  return {
    minPrice: config?.minStockPrice ?? getMinStockPrice(),
    maxPrice: config?.maxStockPrice ?? getMaxStockPrice(),
    minAvgDailyVolume:
      config?.minAvgDailyVolume ?? getMinAvgDailyVolume(),
    maxSpreadPercent:
      config?.maxSpreadPercent ?? getSmallAccountMaxSpreadPercent(),
    majorExchangeOnly: true,
    avoidOtc: config?.avoidOtc ?? shouldAvoidOtc(),
  };
}

export function isMajorExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  const ex = exchange.trim().toUpperCase();
  if (MAJOR_EXCHANGES.has(ex)) return true;
  return ex.includes("NASDAQ") || ex.includes("NYSE");
}

export function isOtcExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  return /OTC/i.test(exchange);
}

/** Average daily share volume from recent daily bars. */
export function estimateAvgDailyVolume(
  dailyBars: AlpacaBar[],
): number | null {
  const volumes = dailyBars.map((b) => b.v).filter((v) => v > 0);
  if (volumes.length < 3) return null;
  return volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
}

export function evaluateSmallAccountCandidate(
  input: SmallAccountCandidateInput,
): SmallAccountCandidateResult {
  const filters = { ...filtersFromConfig(), ...input.filters };
  const reasons: string[] = [];
  const warnings = [...SMALL_ACCOUNT_WARNINGS];

  if (input.price == null || !(input.price > 0)) {
    reasons.push("Price unavailable — cannot validate for small account mode.");
    return {
      symbol: input.symbol,
      ok: false,
      eligible: false,
      reasons,
      warnings,
      price: input.price,
      spreadPercent: input.spreadPercent,
      avgDailyVolume: input.avgDailyVolume,
      exchange: input.exchange,
    };
  }

  if (input.price < filters.minPrice) {
    reasons.push(
      `Price $${input.price.toFixed(2)} is below minimum $${filters.minPrice.toFixed(2)} (penny-stock guard).`,
    );
  }
  if (input.price > filters.maxPrice) {
    reasons.push(
      `Price $${input.price.toFixed(2)} exceeds max $${filters.maxPrice.toFixed(2)} for small account mode.`,
    );
  }

  if (filters.avoidOtc && isOtcExchange(input.exchange)) {
    reasons.push(`Exchange ${input.exchange ?? "unknown"} is OTC — avoided when AVOID_OTC=true.`);
  }
  if (filters.majorExchangeOnly && !isMajorExchange(input.exchange)) {
    reasons.push(
      `Exchange ${input.exchange ?? "unknown"} is not a major U.S. listing.`,
    );
  }

  const spreadPct =
    input.spreadPercent != null ? input.spreadPercent * 100 : null;
  if (spreadPct == null) {
    reasons.push("Spread cannot be measured.");
  } else if (spreadPct > filters.maxSpreadPercent) {
    reasons.push(
      `Spread ${spreadPct.toFixed(2)}% exceeds max ${filters.maxSpreadPercent.toFixed(2)}%.`,
    );
  }

  if (input.avgDailyVolume == null) {
    reasons.push("Average daily volume unavailable.");
  } else if (input.avgDailyVolume < filters.minAvgDailyVolume) {
    reasons.push(
      `Avg daily volume ${Math.round(input.avgDailyVolume).toLocaleString()} is below minimum ${filters.minAvgDailyVolume.toLocaleString()}.`,
    );
  }

  const eligible = reasons.length === 0;
  return {
    symbol: input.symbol,
    ok: true,
    eligible,
    reasons,
    warnings,
    price: input.price,
    spreadPercent: input.spreadPercent,
    avgDailyVolume: input.avgDailyVolume,
    exchange: input.exchange,
  };
}

export type SmallAccountFitInput = {
  lastPrice: number | null;
  spreadPercent: number | null;
  volumeRatio: number | null;
  trendPct: number | null;
  exchange?: string | null;
  maxPrice?: number;
};

export type SmallAccountFitScore = {
  bonus: number;
  eligible: boolean;
  reasons: string[];
};

/**
 * Scoring adjustment for small account mode — favors liquidity, tight spread,
 * clean trend, and major exchange; lower price only when quality is acceptable.
 */
export function scoreSmallAccountFit(
  input: SmallAccountFitInput,
): SmallAccountFitScore {
  const reasons: string[] = [];
  let bonus = 0;
  const maxPrice = input.maxPrice ?? getMaxStockPrice();

  if (input.lastPrice == null || !(input.lastPrice > 0)) {
    return { bonus: -0.08, eligible: false, reasons: ["Price unavailable"] };
  }

  if (input.lastPrice > maxPrice) {
    return {
      bonus: -0.12,
      eligible: false,
      reasons: [`Price above $${maxPrice} small-account cap`],
    };
  }
  if (input.lastPrice < getMinStockPrice()) {
    return {
      bonus: -0.15,
      eligible: false,
      reasons: ["Below minimum stock price (penny guard)"],
    };
  }

  const spreadLimit = getSmallAccountMaxSpreadPercent() / 100;
  if (input.spreadPercent == null) {
    bonus -= 0.06;
    reasons.push("Spread unknown");
  } else if (input.spreadPercent <= spreadLimit * 0.5) {
    bonus += 0.06;
    reasons.push("Tight spread");
  } else if (input.spreadPercent > spreadLimit) {
    bonus -= 0.1;
    reasons.push("Spread too wide for small account mode");
  }

  if (input.volumeRatio != null) {
    if (input.volumeRatio >= 1.2) {
      bonus += 0.05;
      reasons.push("Strong volume");
    } else if (input.volumeRatio < 0.7) {
      bonus -= 0.08;
      reasons.push("Thin volume");
    }
  }

  if (input.trendPct != null) {
    const abs = Math.abs(input.trendPct);
    if (abs >= 0.4 && abs <= 2.5) {
      bonus += 0.04;
      reasons.push("Clean trend");
    } else if (abs > 4) {
      bonus -= 0.05;
      reasons.push("Choppy / extreme move");
    }
  }

  if (input.exchange) {
    if (isOtcExchange(input.exchange) && shouldAvoidOtc()) {
      bonus -= 0.2;
      reasons.push("OTC listing");
    } else if (isMajorExchange(input.exchange)) {
      bonus += 0.03;
      reasons.push("Major exchange");
    }
  }

  if (input.lastPrice <= maxPrice * 0.6 && bonus >= 0) {
    bonus += 0.02;
    reasons.push("Affordable with acceptable quality");
  }

  const eligible =
    input.lastPrice <= maxPrice &&
    input.lastPrice >= getMinStockPrice() &&
    !(input.exchange && isOtcExchange(input.exchange) && shouldAvoidOtc());

  return {
    bonus: Number(Math.max(-0.2, Math.min(0.15, bonus)).toFixed(3)),
    eligible,
    reasons,
  };
}
