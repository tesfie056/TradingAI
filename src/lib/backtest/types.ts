/**
 * Milestone I-2 backtest types — paper simulation only.
 */

import type { MarketRegime } from "@/lib/learning/regime";

export type SpreadModelId =
  | "historical_quote"
  | "fixed_bps"
  | "atr_pct"
  | "conservative_fallback";

export type SlippageModelId =
  | "fixed_bps"
  | "volume_sensitive"
  | "volatility_sensitive"
  | "conservative_stress";

export type DataQualitySeverity = "WARNING" | "BLOCKING";

export type DataQualityIssue = {
  code: string;
  severity: DataQualitySeverity;
  message: string;
  symbol?: string;
  timestamp?: string;
};

export type HistoricalBar = {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number | null;
  vwap: number | null;
  bid: number | null;
  ask: number | null;
  adjusted: boolean;
  source: string;
  retrievedAt: string;
};

export type ChronologicalSplit = {
  id: string;
  training: { start: string; end: string };
  validation: { start: string; end: string };
  purgeGapDays: number;
  outOfSample: { start: string; end: string } | null;
  outOfSampleLocked: boolean;
};

export type WalkForwardFold = {
  foldIndex: number;
  trainingStart: string;
  trainingEnd: string;
  validationStart: string;
  validationEnd: string;
  purgeGapDays: number;
  symbols: string[];
  trades: number;
  totalReturn: number;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  sortino: number | null;
  avgWinner: number | null;
  avgLoser: number | null;
  consecutiveLosses: number;
  byRegime: Record<string, number>;
  bySymbol: Record<string, number>;
  passed: boolean;
  failReason: string | null;
};

export type ExecutionAssumptions = {
  spreadModel: SpreadModelId;
  slippageModel: SlippageModelId;
  fixedSpreadBps: number;
  fixedSlippageBps: number;
  atrSpreadMult: number;
  sameCandleStopFirst: true;
  feeBps: number;
  startingEquity: number;
  notes: string[];
};

export type SimTrade = {
  id: string;
  symbol: string;
  direction: "long";
  strategyVersion: string;
  entryTime: string;
  exitTime: string;
  plannedEntry: number;
  fillEntry: number;
  stopLoss: number;
  takeProfit: number;
  exitPrice: number;
  exitReason: "stop" | "target" | "eod" | "signal" | "forced";
  qty: number;
  notional: number;
  realizedPnl: number;
  returnPct: number;
  spreadCost: number;
  slippageCost: number;
  holdingBars: number;
  regime: MarketRegime | "unknown";
  confidence: number;
  sameCandleCollision: boolean;
};

export type BacktestMetrics = {
  totalTrades: number;
  winRate: number | null;
  lossRate: number | null;
  totalReturn: number;
  avgReturnPerTrade: number | null;
  avgWinner: number | null;
  avgLoser: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdown: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  recoveryFactor: number | null;
  consecutiveWins: number;
  consecutiveLosses: number;
  avgHoldingBars: number | null;
  exposure: number | null;
  turnover: number | null;
  spreadCostTotal: number;
  slippageCostTotal: number;
  totalReturnBeforeCosts: number;
  totalReturnAfterCosts: number;
  bySymbol: Record<string, { trades: number; pnl: number; winRate: number | null }>;
  byRegime: Record<string, { trades: number; pnl: number }>;
  byMonth: Record<string, { trades: number; pnl: number }>;
  byHourEt: Record<string, { trades: number; pnl: number }>;
  byConfidence: Record<string, { trades: number; pnl: number }>;
  statisticallyWeak: boolean;
  weakReason: string | null;
};

export type BacktestRunRecord = {
  id: string;
  createdAt: string;
  kind: "baseline" | "challenger" | "walk_forward" | "oos";
  strategyId: string;
  strategyVersion: string;
  parentVersion: string | null;
  datasetId: string;
  symbols: string[];
  timeframe: "1Min" | "5Min" | "1Day";
  periodStart: string;
  periodEnd: string;
  split: ChronologicalSplit | null;
  assumptions: ExecutionAssumptions;
  dataQuality: {
    warnings: DataQualityIssue[];
    blocking: DataQualityIssue[];
    passed: boolean;
  };
  metrics: BacktestMetrics;
  trades: SimTrade[];
  folds: WalkForwardFold[];
  reproducibleFrom: {
    strategyVersion: string;
    datasetId: string;
    dateRange: { start: string; end: string };
    universe: string[];
    timeframe: string;
    parameters: Record<string, number | string | boolean>;
    spreadModel: SpreadModelId;
    slippageModel: SlippageModelId;
    riskProfile: string;
    randomSeed: null;
  };
  promotionEligible: boolean;
  promotionBlockers: string[];
  paperOnly: true;
  liveTradingAllowed: false;
  brokerOrdersSubmitted: false;
  disclaimer: string;
  /** Milestone I-3 real-data provenance */
  realDataOnly: boolean;
  syntheticDataUsed: boolean;
  label: "REAL HISTORICAL BACKTEST" | "SYNTHETIC BACKTEST" | "MIXED / INVALID";
  sourceBySymbol: Record<string, string>;
  sourceByTimeframe: Record<string, string>;
  missingPeriods: { symbol: string; start: string; end: string; reason: string }[];
  excludedSymbols: { symbol: string; reason: string }[];
  coveragePercentage: number | null;
  dataQualityStatus: "READY" | "PARTIAL" | "BLOCKED" | "STALE" | "UNKNOWN";
  /** Milestone I-4 stable fingerprint */
  runFingerprint: import("@/lib/backtest/fingerprint").RunFingerprint | null;
  comparableNote: string | null;
};

export type PromotionCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type PromotionEligibility = {
  strategyVersion: string;
  eligible: boolean;
  checks: PromotionCheck[];
  manualApprovalRequired: true;
  promotionEnabled: false;
  paperOnly: true;
  liveTradingAllowed: false;
};
