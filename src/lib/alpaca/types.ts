export type AlpacaAccount = {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  buying_power: string;
  last_equity: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  transfers_blocked: boolean;
  account_blocked: boolean;
};

export type AlpacaBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type AlpacaQuote = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  timestamp: string | null;
};

export type AlpacaOrder = {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  qty: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  order_class: string;
  order_type: string;
  type: string;
  side: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  extended_hours: boolean;
};

/** Alpaca /v2/clock response (paper trading API). */
export type AlpacaClock = {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
};

export type MarketClockStatus = {
  isOpen: boolean;
  timestamp: string;
  nextOpen: string;
  nextClose: string;
  paperOnly: true;
};

/** Phase 2.5 per-symbol data quality. */
export type DataQuality = {
  isMarketOpen: boolean;
  isQuoteStale: boolean;
  spreadPercent: number | null;
  hasRecentBars: boolean;
  warningMessages: string[];
};

/** Phase 2 structured action labels. */
export type AiAction = "BUY" | "SELL" | "HOLD";

/** Phase 6.5: low / medium / high (legacy "elevated" accepted as medium). */
export type RiskStatus = "low" | "medium" | "high" | "unknown" | "elevated";

export type MarketConditionLabel =
  | "bullish"
  | "bearish"
  | "choppy"
  | "unclear";

export type DecisionScores = {
  technicalScore: number;
  newsScore: number;
  marketScore: number;
  riskScore: number;
  finalScore: number;
  confidence: number;
};

export type DecisionExplanation = {
  technical: string;
  news: string;
  market: string;
  risk: string;
  summary: string;
};

export type SymbolMarketSnapshot = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  spreadPct: number | null;
  bars: AlpacaBar[];
  timeframe: "1Min" | "5Min" | "15Min";
  quoteTimestamp: string | null;
  dataQuality: DataQuality;
  bars1Min?: AlpacaBar[];
  bars5Min?: AlpacaBar[];
  bars15Min?: AlpacaBar[];
};

export type AiDecision = {
  symbol: string;
  action: AiAction;
  confidence: number;
  reasons: string[];
  riskWarnings: string[];
  riskStatus: RiskStatus;
  /** Display risk: low / medium / high */
  riskLevel?: "low" | "medium" | "high" | "unknown";
  timestamp: string;
  paperOnly: true;
  assetClass?: "us_equity";
  dataQuality?: DataQuality;
  newsContext?: {
    overallSentiment: "positive" | "negative" | "neutral" | null;
    highestImportance: "low" | "medium" | "high" | null;
    sentimentScore: number;
    explanation: string;
    headlines: string[];
  };
  scores?: DecisionScores;
  explanation?: DecisionExplanation;
  marketCondition?: {
    label: MarketConditionLabel;
    marketScore: number;
    spyTrendPct: number | null;
    qqqTrendPct: number | null;
    explanation: string;
  };
  readyForManualPaperTrade?: boolean;
  tradeBlockReasons?: string[];
  metrics?: {
    last: number | null;
    mid: number | null;
    spreadPct: number | null;
    trendPct: number | null;
    rangePct: number | null;
    volumeRatio: number | null;
    vwap?: number | null;
    support?: number | null;
    resistance?: number | null;
    gapPct?: number | null;
    gapLabel?: string | null;
  };
};

/** Local decision history entry (no secrets). */
export type DecisionHistoryEntry = {
  symbol: string;
  action: AiAction;
  confidence: number;
  reasons: string[];
  riskWarnings: string[];
  timestamp: string;
  paperOnly: true;
  // Phase 5 optional fields (present on newer rows)
  priceAtDecision?: number | null;
  marketOpen?: boolean;
  newsSentiment?: "positive" | "negative" | "neutral" | null;
  aiProvider?: "heuristic" | "ollama" | "unknown";
};
