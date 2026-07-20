/**
 * Version 1 simple long — types.
 *
 * Decision definitions:
 * - BUY: qualified long entry candidate (planning only in V1-3 — no order submit)
 * - WATCH: eligible & promising but not ready
 * - SKIP: blocked this scan by safety/data/timing/conflict
 * - HOLD: neutral — no new long, not a specific WATCH or SKIP
 */

export type V1DecisionLabel = "BUY" | "WATCH" | "SKIP" | "HOLD";

export type V1ConditionCategory =
  | "safety"
  | "market_data"
  | "universe"
  | "trend"
  | "momentum"
  | "volume"
  | "volatility"
  | "timing"
  | "position_state";

export type V1ConditionResult = {
  id: string;
  name: string;
  category: V1ConditionCategory;
  mandatory: boolean;
  actual: string | number | boolean | null;
  expected: string;
  passed: boolean;
  explanation: string;
};

export type V1IndicatorValues = {
  price: number | null;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
  dataAgeMs: number | null;
  entryFastMa: number | null;
  entrySlowMa: number | null;
  entryFastAboveSlow: boolean;
  entryPriceAboveMas: boolean;
  entryFastSlope: number | null;
  trendFastMa: number | null;
  trendSlowMa: number | null;
  trendFastAboveSlow: boolean;
  trend5MinPct: number | null;
  trend15MinPct: number | null;
  volumeRatio: number | null;
  rangePct: number | null;
  volatilityLabel: string | null;
  vwap: number | null;
  vwapBias: string | null;
  technicalLean: number | null;
};

export type V1StrategyResult = {
  strategyId: string;
  strategyVersion: string;
  symbol: string;
  evaluatedAt: string;
  marketSessionOpen: boolean | null;
  latestPrice: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  spreadPercent: number | null;
  dataAgeMs: number | null;
  timeframes: { entry: string; trend: string };
  decision: V1DecisionLabel;
  score: number;
  buyThreshold: number;
  watchThreshold: number;
  confidence: number;
  mandatoryPassed: string[];
  mandatoryFailed: string[];
  optionalPassed: string[];
  optionalFailed: string[];
  conditions: V1ConditionResult[];
  primaryReasons: string[];
  blockReasons: string[];
  riskWarnings: string[];
  indicators: V1IndicatorValues;
  suggestedEntry: number | null;
  suggestedStopLoss: number | null;
  suggestedTakeProfit: number | null;
  expectedReward: number | null;
  maximumExpectedLoss: number | null;
  rewardToRisk: number | null;
  /** Planning only — never submitted in V1-3 */
  planningOnly: true;
  paperOnly: true;
  explanation: string;
};

export type V1StrategyContext = {
  isMarketOpen: boolean;
  minutesSinceOpen: number | null;
  minutesToClose: number | null;
  hasOpenPosition: boolean;
  hasPendingEntry: boolean;
  hasPendingExit: boolean;
  reconciliationComplete: boolean;
  universeEligible: boolean;
  openEntryDelayMinutes: number;
  eodEntryCutoffMinutes: number;
  minPrice: number;
  maxPrice: number;
  /** Percent points, e.g. 0.5 = 0.5% */
  maxSpreadPercent: number;
  stopLossPct: number;
  takeProfitPct: number;
  nowMs?: number;
  scanId?: string;
};
