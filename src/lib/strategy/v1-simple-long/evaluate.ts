/**
 * Version 1 simple long entry evaluator.
 * Deterministic. Never places, cancels, or modifies orders/positions.
 * LLM must not call this — only explain after the fact.
 */

import type { AlpacaBar, AlpacaQuote, DataQuality } from "@/lib/alpaca/types";
import { isQuoteStale } from "@/lib/market/data-quality";
import {
  analyzeStockTechnicals,
  computeMaAlignment,
} from "@/lib/stocks/technicals";
import {
  getV1SimpleLongConfig,
  type V1StrategyConfig,
} from "@/lib/strategy/v1-simple-long/config";
import type {
  V1ConditionResult,
  V1StrategyContext,
  V1StrategyResult,
  V1DecisionLabel,
} from "@/lib/strategy/v1-simple-long/types";
import { buildV1FallbackExplanation } from "@/lib/strategy/v1-simple-long/explain";

function cond(
  partial: Omit<V1ConditionResult, "passed"> & { passed: boolean },
): V1ConditionResult {
  return partial;
}

function clamp01(n: number): number {
  return Math.min(0.95, Math.max(0.05, Number(n.toFixed(4))));
}

export type EvaluateV1SimpleLongInput = {
  symbol: string;
  quote?: AlpacaQuote | null;
  bars5Min: AlpacaBar[];
  bars15Min: AlpacaBar[];
  bars1Min?: AlpacaBar[];
  dataQuality: DataQuality;
  context: V1StrategyContext;
  config?: V1StrategyConfig;
};

/**
 * Evaluate one symbol for Version 1 long-only entry.
 * Suggested SL/TP are planning outputs only — never submitted here.
 */
export function evaluateV1SimpleLong(
  input: EvaluateV1SimpleLongInput,
): V1StrategyResult {
  const cfg = input.config ?? getV1SimpleLongConfig();
  const symbol = input.symbol.trim().toUpperCase();
  const evaluatedAt = new Date().toISOString();
  const nowMs = input.context.nowMs ?? Date.now();
  const dq = input.dataQuality;
  const quote = input.quote ?? null;
  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const spread =
    bid != null && ask != null && bid > 0 && ask > 0 ? ask - bid : null;
  const mid =
    bid != null && ask != null && bid > 0 && ask > 0
      ? (bid + ask) / 2
      : (input.bars5Min.at(-1)?.c ?? null);
  const price = mid ?? input.bars5Min.at(-1)?.c ?? null;

  const technical = analyzeStockTechnicals({
    bars1Min: input.bars1Min,
    bars5Min: input.bars5Min,
    bars15Min: input.bars15Min,
    lastPrice: price,
  });

  const entryMa = computeMaAlignment(
    input.bars5Min,
    cfg.fastMaEntry,
    cfg.slowMaEntry,
  );
  const trendMa = computeMaAlignment(
    input.bars15Min,
    cfg.fastMaTrend,
    cfg.slowMaTrend,
  );

  const trend5 =
    technical.trends.find((t) => t.timeframe === "5Min")?.trendPct ?? null;
  const trend15 =
    technical.trends.find((t) => t.timeframe === "15Min")?.trendPct ?? null;

  const quoteTs = quote?.timestamp ?? null;
  const dataAgeMs =
    quoteTs != null && !Number.isNaN(Date.parse(quoteTs))
      ? Math.max(0, nowMs - Date.parse(quoteTs))
      : null;
  const quoteStale =
    input.context.isMarketOpen && isQuoteStale(quoteTs, true, nowMs);

  const maxSpreadFrac = input.context.maxSpreadPercent / 100;
  const spreadPct = dq.spreadPercent;

  const conditions: V1ConditionResult[] = [];

  // --- Safety / market data / universe / timing / position (mandatory) ---
  conditions.push(
    cond({
      id: "safety_long_only",
      name: "Long-only strategy",
      category: "safety",
      mandatory: true,
      actual: true,
      expected: "Long-only Version 1 (no short entries)",
      passed: true,
      explanation: "Version 1 only considers new long entries.",
    }),
  );

  conditions.push(
    cond({
      id: "market_data_quote_available",
      name: "Quote available",
      category: "market_data",
      mandatory: true,
      actual: price,
      expected: "Usable bid/ask or last price",
      passed: price != null && price > 0,
      explanation:
        price != null && price > 0
          ? `Price $${price.toFixed(2)} is available.`
          : "Current quote is unavailable.",
    }),
  );

  conditions.push(
    cond({
      id: "market_data_fresh",
      name: "Market data fresh",
      category: "market_data",
      mandatory: true,
      actual: dataAgeMs,
      expected: "Quote not stale while market is open",
      passed: !input.context.isMarketOpen || quoteStale !== true,
      explanation: !input.context.isMarketOpen
        ? "Market closed — freshness enforced as a timing block instead."
        : quoteStale
          ? "Market data is stale during the open session."
          : "Quote freshness is acceptable.",
    }),
  );

  conditions.push(
    cond({
      id: "market_data_spread_ok",
      name: "Bid/ask spread acceptable",
      category: "market_data",
      mandatory: true,
      actual: spreadPct,
      expected: `Spread ≤ ${input.context.maxSpreadPercent}%`,
      passed:
        spreadPct != null &&
        Number.isFinite(spreadPct) &&
        spreadPct <= maxSpreadFrac,
      explanation:
        spreadPct == null
          ? "Bid/ask spread is unavailable."
          : spreadPct <= maxSpreadFrac
            ? `Spread ${(spreadPct * 100).toFixed(3)}% is within the limit.`
            : `Bid/ask spread is too wide (${(spreadPct * 100).toFixed(3)}%).`,
    }),
  );

  conditions.push(
    cond({
      id: "universe_price_in_range",
      name: "Price inside Version 1 range",
      category: "universe",
      mandatory: true,
      actual: price,
      expected: `$${input.context.minPrice}–$${input.context.maxPrice}`,
      passed:
        price != null &&
        price >= input.context.minPrice &&
        price <= input.context.maxPrice,
      explanation:
        price == null
          ? "Price unavailable for universe check."
          : price < input.context.minPrice
            ? "Price is below the Version 1 range."
            : price > input.context.maxPrice
              ? "Price is above the Version 1 range."
              : "Price is inside the Version 1 range.",
    }),
  );

  conditions.push(
    cond({
      id: "universe_eligible",
      name: "Universe eligible",
      category: "universe",
      mandatory: true,
      actual: input.context.universeEligible,
      expected: "Symbol passed universe filters",
      passed: input.context.universeEligible,
      explanation: input.context.universeEligible
        ? "Symbol is in the eligible universe."
        : "Symbol is not universe-eligible for Version 1.",
    }),
  );

  conditions.push(
    cond({
      id: "timing_market_open",
      name: "Regular market open",
      category: "timing",
      mandatory: true,
      actual: input.context.isMarketOpen,
      expected: "U.S. regular session open",
      passed: input.context.isMarketOpen,
      explanation: input.context.isMarketOpen
        ? "Regular market session is open."
        : "Market is closed — new entries are blocked.",
    }),
  );

  const sinceOpen = input.context.minutesSinceOpen;
  const openDelayOk =
    sinceOpen == null
      ? !input.context.isMarketOpen
        ? false
        : input.context.openEntryDelayMinutes <= 0
      : sinceOpen >= input.context.openEntryDelayMinutes;
  conditions.push(
    cond({
      id: "timing_open_delay",
      name: "Opening delay satisfied",
      category: "timing",
      mandatory: true,
      actual: sinceOpen,
      expected: `≥ ${input.context.openEntryDelayMinutes} minutes after open`,
      passed: !input.context.isMarketOpen ? false : openDelayOk,
      explanation: !input.context.isMarketOpen
        ? "Opening delay not applicable while closed."
        : openDelayOk
          ? "Opening delay has passed."
          : "Too close to the open — waiting for the opening delay.",
    }),
  );

  const toClose = input.context.minutesToClose;
  const eodOk =
    toClose == null
      ? false
      : toClose > input.context.eodEntryCutoffMinutes;
  conditions.push(
    cond({
      id: "timing_eod_cutoff",
      name: "End-of-day entry cutoff",
      category: "timing",
      mandatory: true,
      actual: toClose,
      expected: `> ${input.context.eodEntryCutoffMinutes} minutes before close`,
      passed: input.context.isMarketOpen && eodOk,
      explanation: !input.context.isMarketOpen
        ? "End-of-day cutoff not applicable while closed."
        : eodOk
          ? "Enough time remains before the end-of-day cutoff."
          : "Too close to the close — new entries are blocked.",
    }),
  );

  conditions.push(
    cond({
      id: "position_no_open",
      name: "No existing position",
      category: "position_state",
      mandatory: true,
      actual: input.context.hasOpenPosition,
      expected: "No open position in this symbol",
      passed: !input.context.hasOpenPosition,
      explanation: input.context.hasOpenPosition
        ? "An existing position conflicts with a new long entry."
        : "No open position in this symbol.",
    }),
  );

  conditions.push(
    cond({
      id: "position_no_pending_entry",
      name: "No pending entry order",
      category: "position_state",
      mandatory: true,
      actual: input.context.hasPendingEntry,
      expected: "No pending entry order",
      passed: !input.context.hasPendingEntry,
      explanation: input.context.hasPendingEntry
        ? "A pending entry order already exists."
        : "No pending entry order.",
    }),
  );

  conditions.push(
    cond({
      id: "position_reconcile_ok",
      name: "Reconciliation complete",
      category: "position_state",
      mandatory: true,
      actual: input.context.reconciliationComplete,
      expected: "Broker state reconciled",
      passed: input.context.reconciliationComplete,
      explanation: input.context.reconciliationComplete
        ? "Reconciliation is complete."
        : "Reconciliation uncertainty — new entries are blocked.",
    }),
  );

  const barsOk =
    input.bars5Min.length >= cfg.minBarsEntry &&
    input.bars15Min.length >= cfg.minBarsTrend;
  conditions.push(
    cond({
      id: "market_data_bars_sufficient",
      name: "Enough bars for indicators",
      category: "market_data",
      mandatory: true,
      actual: `${input.bars5Min.length}×5Min / ${input.bars15Min.length}×15Min`,
      expected: `≥${cfg.minBarsEntry}×5Min and ≥${cfg.minBarsTrend}×15Min`,
      passed: barsOk,
      explanation: barsOk
        ? "Enough bars are available for moving averages."
        : "Not enough bars to compute the Version 1 indicators.",
    }),
  );
  const volOk =
    technical.rangePct != null &&
    technical.rangePct >= cfg.minRangePct &&
    technical.rangePct <= cfg.maxRangePct;
  conditions.push(
    cond({
      id: "volatility_suitable",
      name: "Volatility suitable",
      category: "volatility",
      mandatory: true,
      actual: technical.rangePct,
      expected: `${(cfg.minRangePct * 100).toFixed(2)}%–${(cfg.maxRangePct * 100).toFixed(2)}% range`,
      passed: volOk,
      explanation:
        technical.rangePct == null
          ? "Volatility is unknown."
          : technical.rangePct > cfg.maxRangePct
            ? "Volatility is too high for the configured stop."
            : technical.rangePct < cfg.minRangePct
              ? "Volatility is too low to reasonably reach the take-profit."
              : "Volatility is suitable for Version 1 risk targets.",
    }),
  );

  // --- Technical conditions (mandatory for BUY) ---
  conditions.push(
    cond({
      id: "trend_fast_above_slow",
      name: "Fast MA above slow MA (5-minute)",
      category: "trend",
      mandatory: true,
      actual: entryMa.fastAboveSlow,
      expected: `SMA(${cfg.fastMaEntry}) > SMA(${cfg.slowMaEntry}) on 5Min`,
      passed: entryMa.fastAboveSlow,
      explanation: entryMa.fastAboveSlow
        ? "The short-term average is above the longer average."
        : "Moving averages are not aligned for an uptrend.",
    }),
  );

  conditions.push(
    cond({
      id: "trend_price_above_mas",
      name: "Price above both moving averages",
      category: "trend",
      mandatory: true,
      actual: entryMa.priceAboveBoth,
      expected: "Price above fast and slow 5Min MAs",
      passed: entryMa.priceAboveBoth,
      explanation: entryMa.priceAboveBoth
        ? "Price is trading above both moving averages."
        : "Price is not above both moving averages.",
    }),
  );

  const maNotDeclining =
    entryMa.slopeFast == null ||
    entryMa.slopeFast >= cfg.maxFastMaDeclinePct;
  conditions.push(
    cond({
      id: "trend_ma_not_declining",
      name: "Moving averages not declining hard",
      category: "trend",
      mandatory: true,
      actual: entryMa.slopeFast,
      expected: `Fast MA slope ≥ ${(cfg.maxFastMaDeclinePct * 100).toFixed(2)}%`,
      passed: entryMa.fastMa != null && maNotDeclining,
      explanation: entryMa.fastMa == null
        ? "Fast moving average unavailable."
        : maNotDeclining
          ? "Moving averages are not strongly declining."
          : "Moving averages are declining — trend is weak.",
    }),
  );

  conditions.push(
    cond({
      id: "trend_higher_tf_confirm",
      name: "Higher-timeframe trend not down",
      category: "trend",
      mandatory: true,
      actual: trendMa.fastAboveSlow,
      expected: `15Min SMA(${cfg.fastMaTrend}) ≥ SMA(${cfg.slowMaTrend})`,
      passed: trendMa.fastAboveSlow || (trend15 != null && trend15 >= 0),
      explanation:
        trendMa.fastAboveSlow || (trend15 != null && trend15 >= 0)
          ? "The slower timeframe does not contradict the long entry."
          : "The slower timeframe looks down — skip new longs.",
    }),
  );

  const momentumPositive =
    trend5 != null && trend5 >= cfg.minMomentumTrendPct;
  const momentumNotSpike =
    trend5 == null || trend5 <= cfg.maxMomentumSpikePct;
  conditions.push(
    cond({
      id: "momentum_positive",
      name: "Short-term momentum positive",
      category: "momentum",
      mandatory: true,
      actual: trend5,
      expected: `5Min trend ≥ ${(cfg.minMomentumTrendPct * 100).toFixed(2)}%`,
      passed: momentumPositive,
      explanation: momentumPositive
        ? "Short-term momentum is positive."
        : "Short-term momentum is not positive.",
    }),
  );

  conditions.push(
    cond({
      id: "momentum_not_overextended",
      name: "Momentum not overextended",
      category: "momentum",
      mandatory: true,
      actual: trend5,
      expected: `5Min trend ≤ ${(cfg.maxMomentumSpikePct * 100).toFixed(2)}%`,
      passed: momentumNotSpike,
      explanation: momentumNotSpike
        ? "Momentum is not extremely overextended."
        : "Price spiked too fast — avoid chasing.",
    }),
  );

  const volumeOk =
    technical.volumeRatio != null &&
    technical.volumeRatio >= cfg.minVolumeRatio;
  conditions.push(
    cond({
      id: "volume_confirmation",
      name: "Volume confirmation",
      category: "volume",
      mandatory: true,
      actual: technical.volumeRatio,
      expected: `Volume ratio ≥ ${cfg.minVolumeRatio}`,
      passed: volumeOk,
      explanation: volumeOk
        ? "Recent volume supports the move."
        : "Volume is too weak to confirm the move.",
    }),
  );

  // Optional quality conditions
  const volumeStrong =
    technical.volumeRatio != null &&
    technical.volumeRatio >= cfg.strongVolumeRatio;
  conditions.push(
    cond({
      id: "volume_strong",
      name: "Strong volume (optional)",
      category: "volume",
      mandatory: false,
      actual: technical.volumeRatio,
      expected: `Volume ratio ≥ ${cfg.strongVolumeRatio}`,
      passed: volumeStrong,
      explanation: volumeStrong
        ? "Volume is strong."
        : "Volume is only adequate, not strong.",
    }),
  );

  const vwapOk = technical.vwapBias === "above" || technical.vwapBias === "near";
  conditions.push(
    cond({
      id: "vwap_supportive",
      name: "Price at or above VWAP (optional)",
      category: "trend",
      mandatory: false,
      actual: technical.vwapBias,
      expected: "above or near VWAP",
      passed: vwapOk,
      explanation: vwapOk
        ? "Price is at or above VWAP."
        : "Price is below VWAP.",
    }),
  );

  // --- Score (technical/quality only; mandatory failures still block BUY) ---
  const w = cfg.weights;
  let score = 0;
  score += (entryMa.fastAboveSlow ? 1 : 0) * w.trendAlignment;
  score += (entryMa.priceAboveBoth ? 1 : 0) * w.priceAboveMas;
  score +=
    (trendMa.fastAboveSlow || (trend15 != null && trend15 >= 0) ? 1 : 0) *
    w.trendConfirm;
  score +=
    (momentumPositive && momentumNotSpike ? 1 : momentumPositive ? 0.4 : 0) *
    w.momentum;
  score +=
    (volumeStrong ? 1 : volumeOk ? 0.7 : 0) * w.volume;
  score += (volOk ? 1 : 0) * w.volatility;
  score +=
    (spreadPct != null && spreadPct <= maxSpreadFrac * 0.5
      ? 1
      : spreadPct != null && spreadPct <= maxSpreadFrac
        ? 0.6
        : 0) * w.spreadQuality;
  score += (vwapOk ? 1 : 0) * w.vwap;
  score = clamp01(score);

  const mandatory = conditions.filter((c) => c.mandatory);
  const optional = conditions.filter((c) => !c.mandatory);
  const mandatoryFailed = mandatory.filter((c) => !c.passed).map((c) => c.id);
  const mandatoryPassed = mandatory.filter((c) => c.passed).map((c) => c.id);
  const optionalFailed = optional.filter((c) => !c.passed).map((c) => c.id);
  const optionalPassed = optional.filter((c) => c.passed).map((c) => c.id);

  const hardBlockCategories = new Set([
    "safety",
    "market_data",
    "universe",
    "timing",
    "position_state",
    "volatility",
  ]);
  const hardBlocks = mandatory.filter(
    (c) => !c.passed && hardBlockCategories.has(c.category),
  );
  const techMandatory = mandatory.filter((c) =>
    ["trend", "momentum", "volume"].includes(c.category),
  );
  const techAllPass = techMandatory.every((c) => c.passed);

  let decision: V1DecisionLabel = "HOLD";
  if (hardBlocks.length > 0) {
    decision = "SKIP";
  } else if (techAllPass && score >= cfg.buyThreshold) {
    // Mandatory technicals pass — score cannot override a failed mandatory
    decision = "BUY";
  } else if (score >= cfg.watchThreshold && hardBlocks.length === 0) {
    decision = "WATCH";
  } else {
    decision = "HOLD";
  }

  // Absolute rule: any mandatory failure prevents BUY
  if (mandatoryFailed.length > 0 && decision === "BUY") {
    decision = hardBlocks.length > 0 ? "SKIP" : "WATCH";
  }

  const blockReasons = conditions
    .filter((c) => !c.passed && (c.mandatory || decision === "SKIP"))
    .map((c) => c.explanation);

  const primaryReasons =
    decision === "BUY"
      ? conditions.filter((c) => c.passed).slice(0, 4).map((c) => c.explanation)
      : blockReasons.slice(0, 4);

  const riskWarnings: string[] = [];
  if (technical.volatilityLabel === "elevated") {
    riskWarnings.push("Volatility is elevated — use configured stops.");
  }
  if (input.context.hasPendingExit) {
    riskWarnings.push("A pending exit order exists for related activity.");
  }

  let suggestedEntry: number | null = null;
  let suggestedStopLoss: number | null = null;
  let suggestedTakeProfit: number | null = null;
  let expectedReward: number | null = null;
  let maximumExpectedLoss: number | null = null;
  let rewardToRisk: number | null = null;

  if (price != null && price > 0) {
    suggestedEntry = Number(price.toFixed(4));
    suggestedStopLoss = Number(
      (price * (1 - input.context.stopLossPct / 100)).toFixed(4),
    );
    suggestedTakeProfit = Number(
      (price * (1 + input.context.takeProfitPct / 100)).toFixed(4),
    );
    maximumExpectedLoss = Number(
      (suggestedEntry - suggestedStopLoss).toFixed(4),
    );
    expectedReward = Number(
      (suggestedTakeProfit - suggestedEntry).toFixed(4),
    );
    rewardToRisk =
      maximumExpectedLoss > 0
        ? Number((expectedReward / maximumExpectedLoss).toFixed(3))
        : null;
  }

  const confidence = clamp01(
    0.35 + Math.abs(score - 0.5) * 1.1 + (decision === "BUY" ? 0.08 : 0),
  );

  const resultBase: Omit<V1StrategyResult, "explanation"> = {
    strategyId: cfg.strategyId,
    strategyVersion: cfg.strategyVersion,
    symbol,
    evaluatedAt,
    marketSessionOpen: input.context.isMarketOpen,
    latestPrice: price,
    bid,
    ask,
    spread,
    spreadPercent: spreadPct,
    dataAgeMs,
    timeframes: {
      entry: cfg.entryTimeframe,
      trend: cfg.trendTimeframe,
    },
    decision,
    score,
    buyThreshold: cfg.buyThreshold,
    watchThreshold: cfg.watchThreshold,
    confidence,
    mandatoryPassed,
    mandatoryFailed,
    optionalPassed,
    optionalFailed,
    conditions,
    primaryReasons:
      primaryReasons.length > 0
        ? primaryReasons
        : ["No strong Version 1 setup."],
    blockReasons,
    riskWarnings,
    indicators: {
      price,
      bid,
      ask,
      spreadPct,
      dataAgeMs,
      entryFastMa: entryMa.fastMa,
      entrySlowMa: entryMa.slowMa,
      entryFastAboveSlow: entryMa.fastAboveSlow,
      entryPriceAboveMas: entryMa.priceAboveBoth,
      entryFastSlope: entryMa.slopeFast,
      trendFastMa: trendMa.fastMa,
      trendSlowMa: trendMa.slowMa,
      trendFastAboveSlow: trendMa.fastAboveSlow,
      trend5MinPct: trend5,
      trend15MinPct: trend15,
      volumeRatio: technical.volumeRatio,
      rangePct: technical.rangePct,
      volatilityLabel: technical.volatilityLabel,
      vwap: technical.vwap,
      vwapBias: technical.vwapBias,
      technicalLean: technical.technicalLean,
    },
    suggestedEntry,
    suggestedStopLoss,
    suggestedTakeProfit,
    expectedReward,
    maximumExpectedLoss,
    rewardToRisk,
    planningOnly: true,
    paperOnly: true,
  };

  return {
    ...resultBase,
    explanation: buildV1FallbackExplanation(resultBase),
  };
}
