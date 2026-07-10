import type {
  AiDecision,
  DataQuality,
  DecisionHistoryEntry,
  MarketClockStatus,
} from "@/lib/alpaca/types";
import type { AiProviderStatus } from "@/lib/ai/types";
import type { NewsFetchStatus } from "@/lib/news";
import type { SymbolNewsAnalysis } from "@/lib/news/types";
import type {
  BacktestResult,
  DecisionPerformanceEntry,
  PerformanceSummary,
} from "@/lib/performance/types";
import type { MarketCondition } from "@/lib/stocks/market-condition";

export type AccountPayload = {
  paperOnly: boolean;
  endpoint: string;
  account: {
    cash: string;
    equity: string;
    portfolioValue: string;
    buyingPower: string;
    lastEquity: string;
    status: string;
    currency: string;
    accountNumber: string;
  };
};

export type MarketRow = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  timestamp: string | null;
  dataQuality?: DataQuality | null;
  decision?: AiDecision | null;
};

export type MarketPayload = {
  watchlist: string[];
  market: MarketRow[];
  clock?: MarketClockStatus | null;
};

export type NewsBundle = {
  provider: string;
  bySymbol: Record<string, SymbolNewsAnalysis>;
  status: NewsFetchStatus;
  aiStatus: AiProviderStatus;
};

export type DecisionPayload = {
  paperOnly: true;
  watchlist: string[];
  decisions: AiDecision[];
  clock: MarketClockStatus;
  news: NewsBundle;
  marketCondition?: MarketCondition | null;
  orderExecutionEnabled: boolean;
};

export type NewsPayload = {
  paperOnly: true;
  provider: string;
  watchlist: string[];
  bySymbol: Record<string, SymbolNewsAnalysis>;
  status: NewsFetchStatus;
  aiStatus: AiProviderStatus;
  orderExecutionEnabled: boolean;
};

export type TradeRow = {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: string | null;
  filledQty: string;
  filledAvgPrice: string | null;
  status: string;
  submittedAt: string;
  filledAt: string | null;
};

export type SafetyPayload = {
  ok: boolean;
  paperOnly: boolean;
  liveTradingAllowed: boolean;
  tradingEndpoint?: string;
  error?: string;
};

export type AiHealthPayload = {
  paperOnly: true;
  orderExecutionEnabled: boolean;
  liveTradingAllowed: false;
  requestedProvider: "heuristic" | "ollama";
  ollama: {
    configured: boolean;
    connected: boolean;
    model: string | null;
    host: string | null;
    latencyMs: number | null;
    message: string;
  };
  statusLabel: "heuristic" | "connected" | "fallback";
};

export type PerformancePayload = {
  history: DecisionPerformanceEntry[];
  summary: PerformanceSummary;
};

export type DashboardData = {
  ok: boolean;
  safety: SafetyPayload;
  account: AccountPayload | null;
  clock: MarketClockStatus | null;
  market: MarketPayload | null;
  decisions: AiDecision[];
  marketCondition: MarketCondition | null;
  news: NewsBundle | null;
  aiHealth: AiHealthPayload | null;
  decisionHistory: DecisionHistoryEntry[];
  performance: PerformancePayload | null;
  backtest: BacktestResult | null;
  trades: TradeRow[];
  error: string | null;
  loadedAt: string;
  orderExecutionEnabled: boolean;
};
