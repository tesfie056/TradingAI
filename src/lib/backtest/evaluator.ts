/**
 * Shared strategy evaluation for paper scans, backtests, and shadow mode.
 * Never submits broker orders.
 */

import { decideForSymbol } from "@/lib/ai/decision";
import type { AlpacaBar, AlpacaQuote, SymbolMarketSnapshot } from "@/lib/alpaca/types";
import { assessDataQuality } from "@/lib/market/data-quality";
import { filterBarsAsOf } from "@/lib/learning/feature-snapshot";
import { classifyMarketRegime, type MarketRegime } from "@/lib/learning/regime";
import { computeAtr } from "@/lib/learning/feature-snapshot";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import { buildLongProposal, type TradeProposal } from "@/lib/trading/proposal";
import {
  evaluateRiskProposal,
  type RiskValidationResult,
} from "@/lib/risk/engine";
import type { RiskRuntimeState } from "@/lib/risk/runtime";
import { getChampionIdentity } from "@/lib/strategy/registry";
import { analyzeStockTechnicals } from "@/lib/stocks/technicals";

export type StrategyEvalAccountState = {
  equity: number;
  openPositionCount: number;
  openSymbols: string[];
  pendingEntrySymbols: string[];
  marketOpen: boolean;
  minutesToClose: number | null;
  minutesSinceOpen: number | null;
  riskRuntime: RiskRuntimeState;
  reconciliationComplete: boolean;
  maxNotionalCap?: number;
};

export type StrategyEvalResult = {
  symbol: string;
  direction: "long" | "short" | "flat";
  proposedEntry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number;
  qualificationReasons: string[];
  rejectionReasons: string[];
  strategyVersion: string;
  strategyId: string;
  regime: MarketRegime;
  proposal: TradeProposal | null;
  risk: RiskValidationResult | null;
  action: "BUY" | "SELL" | "HOLD" | "WATCH" | "SKIP";
  paperOnly: true;
  brokerSubmit: false;
};

function emptyRiskRuntime(): RiskRuntimeState {
  return {
    paperOnly: true,
    dayKey: new Date().toISOString().slice(0, 10),
    consecutiveLosses: 0,
    consecutiveWins: 0,
    dailyRealizedPnL: 0,
    dailyUnrealizedPnL: 0,
    entriesPaused: false,
    pauseReason: null,
    lastReconciledAt: null,
    reconciliationComplete: true,
  };
}

/**
 * Deterministic strategy evaluation at a point in time.
 * Uses only bars/quotes with timestamp ≤ decisionTime.
 */
export function evaluateStrategyAt(input: {
  decisionTime: string;
  symbol: string;
  bars5Min: AlpacaBar[];
  bars1Min?: AlpacaBar[];
  bars15Min?: AlpacaBar[];
  quote?: AlpacaQuote | null;
  strategyVersion?: string;
  strategyId?: string;
  account?: Partial<StrategyEvalAccountState>;
  minConfidence?: number;
  skipRiskEngine?: boolean;
  /** Challenger regime blocks (typed params only). */
  blockedRegimes?: string[];
}): StrategyEvalResult {
  const champ = getChampionIdentity();
  const strategyId = input.strategyId ?? champ.strategyId;
  const strategyVersion = input.strategyVersion ?? champ.version;
  const decisionTime = input.decisionTime;

  const b5 = filterBarsAsOf(input.bars5Min, decisionTime);
  const b1 = filterBarsAsOf(input.bars1Min ?? [], decisionTime);
  const b15 = filterBarsAsOf(input.bars15Min ?? [], decisionTime);
  const primary = b5.length >= 5 ? b5 : b15.length >= 5 ? b15 : b1;
  const last = primary.at(-1);

  const rejectionReasons: string[] = [];
  const qualificationReasons: string[] = [];

  if (!last) {
    return {
      symbol: input.symbol.toUpperCase(),
      direction: "flat",
      proposedEntry: null,
      stopLoss: null,
      takeProfit: null,
      confidence: 0,
      qualificationReasons,
      rejectionReasons: ["insufficient_bars"],
      strategyVersion,
      strategyId,
      regime: "weak_uncertain",
      proposal: null,
      risk: null,
      action: "HOLD",
      paperOnly: true,
      brokerSubmit: false,
    };
  }

  const mid = last.c;
  const quote: AlpacaQuote =
    input.quote ??
    ({
      symbol: input.symbol,
      bid: mid * 0.9998,
      ask: mid * 1.0002,
      bidSize: 1,
      askSize: 1,
      timestamp: last.t,
    } as AlpacaQuote);

  const snapshot: SymbolMarketSnapshot = {
    symbol: input.symbol.toUpperCase(),
    bid: quote.bid,
    ask: quote.ask,
    mid: (Number(quote.bid) + Number(quote.ask)) / 2,
    last: last.c,
    spreadPct:
      quote.bid != null && quote.ask != null && quote.bid > 0
        ? (quote.ask - quote.bid) / ((quote.bid + quote.ask) / 2)
        : null,
    bars: primary.slice(-24),
    timeframe: "5Min",
    quoteTimestamp: quote.timestamp,
    dataQuality: assessDataQuality({
      isMarketOpen: input.account?.marketOpen ?? true,
      quote,
      bars: primary.slice(-24),
      nowMs: Date.parse(decisionTime),
    }),
    bars1Min: b1.slice(-30),
    bars5Min: b5.slice(-36),
    bars15Min: b15.slice(-24),
  };

  const decision = decideForSymbol(snapshot);
  const technicals = analyzeStockTechnicals({
    bars1Min: b1,
    bars5Min: b5,
    bars15Min: b15,
    lastPrice: last.c,
  });
  const { atrPct } = computeAtr(primary);
  const { regime } = classifyMarketRegime({
    broadTrendPct: technicals.trends.find((t) => t.timeframe === "15Min")
      ?.trendPct ?? technicals.trends.find((t) => t.timeframe === "5Min")?.trendPct ?? null,
    atrPct,
    rangePct: technicals.rangePct,
    relativeVolume: technicals.volumeRatio,
    trendStrength: technicals.technicalLean,
    vwapBias: technicals.vwapBias,
    priceVsSmaFast: null,
  });

  const minConf = input.minConfidence ?? 0.55;
  if (decision.confidence < minConf) {
    rejectionReasons.push(`confidence_below_${minConf}`);
  }

  if (
    input.blockedRegimes?.length &&
    input.blockedRegimes.includes(regime)
  ) {
    rejectionReasons.push(`regime_blocked_${regime}`);
    return {
      symbol: input.symbol.toUpperCase(),
      direction: "flat",
      proposedEntry: null,
      stopLoss: null,
      takeProfit: null,
      confidence: decision.confidence,
      qualificationReasons,
      rejectionReasons,
      strategyVersion,
      strategyId,
      regime,
      proposal: null,
      risk: null,
      action: "SKIP",
      paperOnly: true,
      brokerSubmit: false,
    };
  }

  if (decision.action !== "BUY") {
    rejectionReasons.push(`action_${decision.action}`);
    return {
      symbol: input.symbol.toUpperCase(),
      direction: "flat",
      proposedEntry: null,
      stopLoss: null,
      takeProfit: null,
      confidence: decision.confidence,
      qualificationReasons,
      rejectionReasons,
      strategyVersion,
      strategyId,
      regime,
      proposal: null,
      risk: null,
      action: decision.action,
      paperOnly: true,
      brokerSubmit: false,
    };
  }

  const cfg = getRiskTradingConfig();
  const proposal = buildLongProposal({
    symbol: input.symbol,
    entry: last.c,
    stopLossPct: cfg.defaultStopLossPct,
    takeProfitPct: cfg.defaultTakeProfitPct,
    confidence: decision.confidence,
    strategyName: `Paper Intelligence ${strategyVersion}`,
    reason: decision.explanation?.summary?.slice(0, 200) ?? "BUY signal",
    indicators: {
      confidence: decision.confidence,
      regime,
      technicalLean: technicals.technicalLean,
    },
  });
  qualificationReasons.push("buy_signal", "long_proposal_built");

  if (input.skipRiskEngine) {
    return {
      symbol: proposal.symbol,
      direction: "long",
      proposedEntry: proposal.proposedEntry,
      stopLoss: proposal.stopLoss,
      takeProfit: proposal.takeProfit,
      confidence: proposal.confidence,
      qualificationReasons,
      rejectionReasons,
      strategyVersion,
      strategyId,
      regime,
      proposal,
      risk: null,
      action: "BUY",
      paperOnly: true,
      brokerSubmit: false,
    };
  }

  const acct: StrategyEvalAccountState = {
    equity: input.account?.equity ?? 100_000,
    openPositionCount: input.account?.openPositionCount ?? 0,
    openSymbols: input.account?.openSymbols ?? [],
    pendingEntrySymbols: input.account?.pendingEntrySymbols ?? [],
    marketOpen: input.account?.marketOpen ?? true,
    minutesToClose: input.account?.minutesToClose ?? 120,
    minutesSinceOpen: input.account?.minutesSinceOpen ?? 60,
    riskRuntime: input.account?.riskRuntime ?? emptyRiskRuntime(),
    reconciliationComplete: input.account?.reconciliationComplete ?? true,
    maxNotionalCap: input.account?.maxNotionalCap,
  };

  const risk = evaluateRiskProposal({
    symbol: proposal.symbol,
    direction: proposal.direction,
    entryPrice: proposal.proposedEntry,
    stopLossPrice: proposal.stopLoss,
    takeProfitPrice: proposal.takeProfit,
    confidence: proposal.confidence,
    equity: acct.equity,
    openPositionCount: acct.openPositionCount,
    openSymbols: acct.openSymbols,
    pendingEntrySymbols: acct.pendingEntrySymbols,
    marketOpen: acct.marketOpen,
    minutesToClose: acct.minutesToClose,
    minutesSinceOpen: acct.minutesSinceOpen,
    riskRuntime: acct.riskRuntime,
    reconciliationComplete: acct.reconciliationComplete,
    maxNotionalCap: acct.maxNotionalCap,
  });

  if (!risk.approved) {
    rejectionReasons.push(risk.code ?? "risk_rejected");
  } else {
    qualificationReasons.push("risk_approved");
  }

  return {
    symbol: proposal.symbol,
    direction: risk.approved ? "long" : "flat",
    proposedEntry: risk.approved ? proposal.proposedEntry : null,
    stopLoss: risk.approved ? proposal.stopLoss : null,
    takeProfit: risk.approved ? proposal.takeProfit : null,
    confidence: proposal.confidence,
    qualificationReasons,
    rejectionReasons,
    strategyVersion,
    strategyId,
    regime,
    proposal: risk.approved ? proposal : proposal,
    risk,
    action: risk.approved ? "BUY" : "HOLD",
    paperOnly: true,
    brokerSubmit: false,
  };
}
