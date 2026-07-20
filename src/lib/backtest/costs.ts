/**
 * Spread and slippage cost models.
 */

import type {
  ExecutionAssumptions,
  HistoricalBar,
  SlippageModelId,
  SpreadModelId,
} from "@/lib/backtest/types";
import { computeAtr } from "@/lib/learning/feature-snapshot";
import { historicalToAlpaca } from "@/lib/backtest/historical-data";

export function defaultAssumptions(
  overrides?: Partial<ExecutionAssumptions>,
): ExecutionAssumptions {
  return {
    spreadModel: "fixed_bps",
    slippageModel: "fixed_bps",
    fixedSpreadBps: 4,
    fixedSlippageBps: 2,
    atrSpreadMult: 0.1,
    sameCandleStopFirst: true,
    feeBps: 0,
    startingEquity: 100_000,
    notes: [
      "Same-candle stop/target collision: stop assumed first (conservative).",
      "No broker orders are submitted in backtest mode.",
    ],
    ...overrides,
  };
}

export function estimateSpreadPct(
  bar: HistoricalBar,
  bars: HistoricalBar[],
  assumptions: ExecutionAssumptions,
): number {
  if (
    assumptions.spreadModel === "historical_quote" &&
    bar.bid != null &&
    bar.ask != null &&
    bar.bid > 0
  ) {
    const mid = (bar.bid + bar.ask) / 2;
    return mid > 0 ? (bar.ask - bar.bid) / mid : assumptions.fixedSpreadBps / 10_000;
  }
  if (assumptions.spreadModel === "atr_pct") {
    const { atrPct } = computeAtr(historicalToAlpaca(bars.slice(-30)));
    if (atrPct != null) {
      return Math.max(atrPct * assumptions.atrSpreadMult, 0.0001);
    }
  }
  if (assumptions.spreadModel === "conservative_fallback") {
    return Math.max(assumptions.fixedSpreadBps / 10_000, 0.001);
  }
  return assumptions.fixedSpreadBps / 10_000;
}

export function estimateSlippagePct(
  bar: HistoricalBar,
  bars: HistoricalBar[],
  assumptions: ExecutionAssumptions,
): number {
  const base = assumptions.fixedSlippageBps / 10_000;
  if (assumptions.slippageModel === "conservative_stress") {
    return Math.max(base * 3, 0.0015);
  }
  if (assumptions.slippageModel === "volatility_sensitive") {
    const { atrPct } = computeAtr(historicalToAlpaca(bars.slice(-30)));
    return base + (atrPct ?? 0.01) * 0.05;
  }
  if (assumptions.slippageModel === "volume_sensitive") {
    const vols = bars.slice(-20).map((b) => b.volume);
    const avg = vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length);
    const ratio = avg > 0 ? bar.volume / avg : 1;
    return ratio < 0.7 ? base * 2 : base;
  }
  return base;
}

export function applyEntryCosts(
  mid: number,
  side: "buy" | "sell",
  spreadPct: number,
  slipPct: number,
): { fill: number; spreadCost: number; slippageCost: number } {
  const halfSpread = mid * (spreadPct / 2);
  const slip = mid * slipPct;
  if (side === "buy") {
    const fill = mid + halfSpread + slip;
    return {
      fill,
      spreadCost: halfSpread,
      slippageCost: slip,
    };
  }
  const fill = mid - halfSpread - slip;
  return {
    fill,
    spreadCost: halfSpread,
    slippageCost: slip,
  };
}

export type CostModelIds = {
  spreadModel: SpreadModelId;
  slippageModel: SlippageModelId;
};
