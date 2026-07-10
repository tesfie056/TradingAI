export type DecisionOutcomeLabel =
  | "correct"
  | "incorrect"
  | "neutral"
  | "pending"
  | "insufficient_data";

export type HorizonKey = "m15" | "h1" | "nextClose";

export type HorizonResult = {
  horizon: HorizonKey;
  price: number | null;
  returnPct: number | null;
  /** Estimated paper P&L assuming 1 share / unit notional at decision price. */
  estimatedPnlPct: number | null;
  reasonable: boolean | null;
  label: DecisionOutcomeLabel;
  evaluatedAt: string | null;
};

export type DecisionPerformanceEntry = {
  id: string;
  symbol: string;
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  priceAtDecision: number | null;
  marketOpen: boolean;
  newsSentiment: "positive" | "negative" | "neutral" | null;
  aiProvider: "heuristic" | "ollama" | "unknown";
  reasons: string[];
  riskWarnings: string[];
  timestamp: string;
  paperOnly: true;
  orderExecuted: false;
  outcomes: {
    m15: HorizonResult;
    h1: HorizonResult;
    nextClose: HorizonResult;
  };
  overallLabel: DecisionOutcomeLabel;
};

export type AccuracyBucket = {
  key: string;
  total: number;
  correct: number;
  incorrect: number;
  neutral: number;
  pending: number;
  accuracy: number | null;
  avgEstimatedPnlPct: number | null;
};

export type PerformanceSummary = {
  totalDecisions: number;
  evaluated: number;
  bySymbol: AccuracyBucket[];
  byAction: AccuracyBucket[];
  confidenceBuckets: AccuracyBucket[];
  paperOnly: true;
  orderExecutionEnabled: false;
};

export type BacktestTradeSim = {
  symbol: string;
  timestamp: string;
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  price: number;
  forwardReturnPct: number | null;
  estimatedPnlPct: number | null;
  reasonable: boolean | null;
  reasons: string[];
};

export type BacktestResult = {
  paperOnly: true;
  orderExecutionEnabled: false;
  liveTradingAllowed: false;
  symbols: string[];
  timeframe: "5Min" | "15Min" | "1Hour";
  barsUsed: number;
  /** Optional requested window (ISO dates). */
  startDate?: string | null;
  endDate?: string | null;
  decisions: BacktestTradeSim[];
  summary: {
    total: number;
    buy: number;
    sell: number;
    hold: number;
    /** Non-HOLD simulated trades. */
    tradeCount: number;
    winRate: number | null;
    avgEstimatedPnlPct: number | null;
    estimatedPnlPctTotal: number | null;
    maxDrawdownPct: number | null;
    accuracy: number | null;
  };
};
