/**
 * Version 1 simple long entry strategy — configuration.
 * Single source of truth for thresholds and weights.
 * Deterministic. Never places orders.
 */

export const V1_STRATEGY_ID = "v1-simple-long" as const;
export const V1_STRATEGY_VERSION = "1.0.0" as const;

/**
 * Decision semantics (long-only):
 * - BUY: all mandatory conditions pass and score ≥ buyThreshold — entry candidate only
 * - WATCH: safe/eligible but technical setup incomplete — may become BUY later
 * - SKIP: blocked this scan (stale data, timing, conflict, unsafe vol, etc.)
 * - HOLD: neutral / no valid new long — not a watch and not a specific block
 */

export type V1StrategyConfig = {
  strategyId: typeof V1_STRATEGY_ID;
  strategyVersion: typeof V1_STRATEGY_VERSION;
  /** Entry setup timeframe */
  entryTimeframe: "5Min";
  /** Trend confirmation timeframe */
  trendTimeframe: "15Min";
  /** Minimum bars required on entry timeframe (includes slow MA lookback) */
  minBarsEntry: number;
  minBarsTrend: number;
  fastMaEntry: number;
  slowMaEntry: number;
  fastMaTrend: number;
  slowMaTrend: number;
  /** Score thresholds 0–1 */
  buyThreshold: number;
  watchThreshold: number;
  /** Volume: recent/earlier ratio minimum for confirmation */
  minVolumeRatio: number;
  /** Strong volume bonus threshold */
  strongVolumeRatio: number;
  /** Reject if short-term trendPct exceeds this (chase / spike) */
  maxMomentumSpikePct: number;
  /** Minimum positive 5Min trendPct for momentum */
  minMomentumTrendPct: number;
  /** Volatility band on primary rangePct */
  minRangePct: number;
  maxRangePct: number;
  /** MA slope: reject if fast MA declining harder than this */
  maxFastMaDeclinePct: number;
  /** Score weights (must sum ~1) */
  weights: {
    trendAlignment: number;
    priceAboveMas: number;
    trendConfirm: number;
    momentum: number;
    volume: number;
    volatility: number;
    spreadQuality: number;
    vwap: number;
  };
};

export const V1_SIMPLE_LONG_CONFIG: V1StrategyConfig = {
  strategyId: V1_STRATEGY_ID,
  strategyVersion: V1_STRATEGY_VERSION,
  entryTimeframe: "5Min",
  trendTimeframe: "15Min",
  minBarsEntry: 22,
  minBarsTrend: 13,
  fastMaEntry: 8,
  slowMaEntry: 21,
  fastMaTrend: 5,
  slowMaTrend: 12,
  buyThreshold: 0.72,
  watchThreshold: 0.55,
  minVolumeRatio: 1.0,
  strongVolumeRatio: 1.4,
  maxMomentumSpikePct: 0.03,
  minMomentumTrendPct: 0.0015,
  minRangePct: 0.004,
  maxRangePct: 0.04,
  maxFastMaDeclinePct: -0.001,
  weights: {
    trendAlignment: 0.22,
    priceAboveMas: 0.14,
    trendConfirm: 0.14,
    momentum: 0.14,
    volume: 0.14,
    volatility: 0.1,
    spreadQuality: 0.08,
    vwap: 0.04,
  },
};

export function getV1SimpleLongConfig(): V1StrategyConfig {
  return {
    ...V1_SIMPLE_LONG_CONFIG,
    weights: { ...V1_SIMPLE_LONG_CONFIG.weights },
  };
}
