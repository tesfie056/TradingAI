import type { V1SmokeProfile } from "@/lib/trading/v1-smoke/profile";

export type V1SmokeReadinessVerdict =
  | "ready_for_operator_preview"
  | "not_ready"
  | "safe_no_trade"
  | "rth_required";

export type V1SmokePreflightReport = {
  paperOnly: true;
  liveTradingAllowed: false;
  stage: "A_preflight";
  tradingDate: string;
  timezone: "America/New_York";
  generatedAt: string;
  marketSession: string;
  marketOpen: boolean;
  alpaca: {
    connected: boolean;
    baseUrlHost: string;
    paperEndpointOk: boolean;
    equity: number | null;
    buyingPower: number | null;
  };
  dataFreshness: string | null;
  eligibleSymbols: string[];
  eligibleCount: number;
  watchlistSize: number;
  strategy: {
    id: string;
    version: string;
    buyCount: number;
    watchCount: number;
    skipCount: number;
    holdCount: number;
    buyCandidates: {
      symbol: string;
      score: number;
      entry: number | null;
      stop: number | null;
      take: number | null;
      rewardToRisk: number | null;
      reason: string;
    }[];
  };
  reconciliationHealthy: boolean;
  criticalLifecycleWarnings: string[];
  activeV1Trades: number;
  pendingEntries: number;
  pendingExits: number;
  openPositions: { symbol: string; qty: number }[];
  openOrders: { id: string; symbol: string; side: string; status: string }[];
  legacyAaplShort: {
    present: boolean;
    qty: number | null;
    ownership: string;
    untouched: true;
    blocksAaplBuy: boolean;
  };
  riskSettings: {
    maxOpenPositions: number;
    maxTradesPerDay: number;
    maxRiskPerTradePct: number;
    maxDailyLossPct: number;
  };
  dailyTarget: {
    target: number;
    completed: number;
    remaining: number;
  };
  executionEnabled: boolean;
  autoTradingEnabled: boolean;
  smokeProfile: V1SmokeProfile;
  readinessVerdict: V1SmokeReadinessVerdict;
  blockingReasons: string[];
  mutations: {
    ordersSubmitted: 0;
    ordersCanceled: 0;
    positionsModified: 0;
  };
  notes: string[];
};

export type V1SmokeResultReport = {
  paperOnly: true;
  stage: "A_smoke_result";
  tradingDate: string;
  generatedAt: string;
  verdict: "pass" | "fail" | "safe_no_trade" | "aborted_not_ready" | "preview_only";
  symbol: string | null;
  entry?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  protection?: Record<string, unknown>;
  exit?: Record<string, unknown>;
  realized?: Record<string, unknown>;
  dailyCount?: Record<string, unknown>;
  aaplShortUntouched: boolean;
  shortCreated: boolean;
  unrelatedMutations: boolean;
  executionFinal: boolean;
  autoTradingFinal: boolean;
  notes: string[];
};
