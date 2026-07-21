/**
 * Phase I Milestone I-1 — learning dataset types.
 * Features are decision-time only; outcomes/labels are separate.
 */

import type { MarketRegime } from "@/lib/learning/regime";

export type LearningEventType =
  | "scan"
  | "candidate"
  | "proposal"
  | "rejection"
  | "order"
  | "fill"
  | "exit"
  | "completed_trade";

export type MarketSession = "regular" | "premarket" | "afterhours" | "closed" | "unknown";

/** Decision-time features — must never include future prices or trade outcomes. */
export type LearningFeatureVector = {
  currentPrice: number | null;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  volume: number | null;
  avgDailyVolume: number | null;
  relativeVolume: number | null;
  volatilityRangePct: number | null;
  atr: number | null;
  atrPct: number | null;
  trendLean: number | null;
  trend1mPct: number | null;
  trend5mPct: number | null;
  trend15mPct: number | null;
  momentumScore: number | null;
  smaFast: number | null;
  smaSlow: number | null;
  priceVsSmaFast: number | null;
  rsi: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  vwap: number | null;
  vwapBias: "above" | "below" | "near" | "unknown";
  recentReturn5: number | null;
  recentReturn20: number | null;
  gapPct: number | null;
  distFromDayHighPct: number | null;
  distFromDayLowPct: number | null;
  sector: string | null;
  broaderMarketDirection: string | null;
  spyTrendPct: number | null;
  qqqTrendPct: number | null;
};

export type LearningFeatureSnapshot = {
  id: string;
  decisionId: string;
  symbol: string;
  decisionTime: string;
  /** Last bar timestamp used (must be ≤ decisionTime). */
  asOfBarTime: string | null;
  marketSession: MarketSession;
  regime: MarketRegime;
  regimeInputs: Record<string, number | string | boolean | null>;
  strategyId: string;
  strategyVersion: string;
  confidence: number | null;
  features: LearningFeatureVector;
  /** Hash of feature inputs only — never outcomes. */
  featureHash: string;
  dataQualityFlags: string[];
  paperOnly: true;
};

export type LearningProposalBlock = {
  proposedEntry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  plannedRisk: number | null;
  plannedReward: number | null;
  riskRewardRatio: number | null;
  direction: string | null;
};

export type LearningRiskBlock = {
  approved: boolean | null;
  code: string | null;
  reason: string | null;
};

export type LearningOrderBlock = {
  orderId: string | null;
  status: string | null;
  result: string | null;
};

export type LearningFillBlock = {
  fillPrice: number | null;
  slippage: number | null;
  plannedEntry: number | null;
};

export type LearningExitBlock = {
  exitPrice: number | null;
  exitReason: string | null;
  holdingDurationMs: number | null;
  mfe: number | null;
  mae: number | null;
  realizedPnl: number | null;
  returnPct: number | null;
  won: boolean | null;
};

/** Outcomes / labels — never mixed into featureHash inputs. */
export type LearningOutcomes = {
  fill?: LearningFillBlock;
  exit?: LearningExitBlock;
  horizonReturns?: Record<string, number | null>;
};

export type LearningEvent = {
  id: string;
  eventType: LearningEventType;
  decisionId: string;
  symbol: string;
  decisionTime: string;
  strategyId: string;
  strategyVersion: string;
  marketSession: MarketSession;
  regime: MarketRegime;
  featureSnapshotId: string | null;
  confidence: number | null;
  proposal: LearningProposalBlock | null;
  risk: LearningRiskBlock | null;
  order: LearningOrderBlock | null;
  /** Outcomes only — not used as model inputs. */
  outcomes: LearningOutcomes | null;
  rejectionReason: string | null;
  paperOnly: true;
};

export type TradeReviewClassification =
  | "good_profitable"
  | "good_losing"
  | "bad_profitable"
  | "bad_losing"
  | "insufficient_data";

export type TradeReviewRecord = {
  id: string;
  decisionId: string;
  symbol: string;
  reviewedAt: string;
  strategyId: string;
  strategyVersion: string;
  regime: MarketRegime | null;
  entryFollowedStrategy: boolean | null;
  riskSizingCorrect: boolean | null;
  slippageAcceptable: boolean | null;
  stopTargetAppropriate: boolean | null;
  mfe: number | null;
  mae: number | null;
  exitTiming: "early" | "late" | "rule_compliant" | "unknown";
  primaryReason: string;
  classification: TradeReviewClassification;
  realizedPnl: number | null;
  paperOnly: true;
};
