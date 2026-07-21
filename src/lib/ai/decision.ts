import type {
  AiDecision,
  AlpacaBar,
  AlpacaQuote,
  DataQuality,
  MarketConditionLabel,
  SymbolMarketSnapshot,
} from "@/lib/alpaca/types";
import { assessDataQuality } from "@/lib/market/data-quality";
import type { SymbolNewsAnalysis } from "@/lib/news/types";
import {
  assessMarketCondition,
  type MarketCondition,
} from "@/lib/stocks/market-condition";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import { filterUsStockSymbols } from "@/lib/stocks/universe";
import {
  evaluateV1SimpleLong,
  minutesSinceRegularOpen,
  minutesUntilRegularClose,
  v1ResultToAiDecision,
  type V1StrategyContext,
} from "@/lib/strategy/v1-simple-long";

function defaultMarket(): MarketCondition {
  return {
    label: "unclear",
    marketScore: 0.5,
    spyTrendPct: null,
    qqqTrendPct: null,
    explanation: "Market benchmarks (SPY/QQQ) not available.",
    paperOnly: true,
  };
}

function buildSnapshot(
  symbol: string,
  quote: AlpacaQuote | undefined,
  bars5Min: AlpacaBar[],
  isMarketOpen: boolean | null,
  extras?: {
    bars1Min?: AlpacaBar[];
    bars15Min?: AlpacaBar[];
    nowMs?: number;
  },
): SymbolMarketSnapshot {
  const bars = bars5Min;
  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const mid =
    bid != null && ask != null
      ? (bid + ask) / 2
      : (bid ?? ask ?? bars.at(-1)?.c ?? null);
  const last = bars.at(-1)?.c ?? mid;
  const dataQuality = assessDataQuality({
    isMarketOpen,
    quote,
    bars,
    nowMs: extras?.nowMs,
  });

  return {
    symbol,
    bid,
    ask,
    mid,
    last,
    spreadPct: dataQuality.spreadPercent,
    bars,
    timeframe: "5Min",
    quoteTimestamp: quote?.timestamp ?? null,
    dataQuality,
    bars1Min: extras?.bars1Min,
    bars5Min,
    bars15Min: extras?.bars15Min,
  };
}

function defaultV1Context(
  isMarketOpen: boolean,
  overrides?: Partial<V1StrategyContext>,
  nowMs?: number,
): V1StrategyContext {
  const cfg = getRiskTradingConfig();
  const now = nowMs ?? Date.now();
  return {
    isMarketOpen,
    minutesSinceOpen: isMarketOpen ? minutesSinceRegularOpen(now) : null,
    minutesToClose: isMarketOpen ? minutesUntilRegularClose(now) : null,
    hasOpenPosition: false,
    hasPendingEntry: false,
    hasPendingExit: false,
    reconciliationComplete: true,
    universeEligible: true,
    openEntryDelayMinutes: cfg.openEntryDelayMinutes,
    eodEntryCutoffMinutes: cfg.eodEntryCutoffMinutes,
    minPrice: cfg.minPrice,
    maxPrice: cfg.maxPrice,
    maxSpreadPercent: cfg.maxSpreadPercent,
    stopLossPct: cfg.defaultStopLossPct,
    takeProfitPct: cfg.defaultTakeProfitPct,
    nowMs: now,
    ...overrides,
  };
}

/**
 * Version 1 long-only decision for one U.S. equity symbol.
 * Uses deterministic v1-simple-long strategy. Never places orders.
 */
export function decideForSymbol(
  snapshot: SymbolMarketSnapshot,
  news?: SymbolNewsAnalysis,
  marketCondition?: MarketCondition,
  v1Context?: Partial<V1StrategyContext>,
): AiDecision {
  const market = marketCondition ?? defaultMarket();
  const dq = snapshot.dataQuality;
  // Strategy gates need a boolean; unavailable clock is treated as not open.
  const isOpen = dq.isMarketOpen === true;
  const context = defaultV1Context(isOpen, v1Context);

  const v1 = evaluateV1SimpleLong({
    symbol: snapshot.symbol,
    quote: {
      symbol: snapshot.symbol,
      bid: snapshot.bid,
      ask: snapshot.ask,
      bidSize: null,
      askSize: null,
      timestamp: snapshot.quoteTimestamp,
    },
    bars5Min: snapshot.bars5Min ?? snapshot.bars,
    bars15Min: snapshot.bars15Min ?? [],
    bars1Min: snapshot.bars1Min,
    dataQuality: dq,
    context,
  });

  const decision = v1ResultToAiDecision(v1, dq);
  decision.newsContext = toNewsContext(news);
  decision.marketCondition = {
    label: market.label as MarketConditionLabel,
    marketScore: market.marketScore,
    spyTrendPct: market.spyTrendPct,
    qqqTrendPct: market.qqqTrendPct,
    explanation: market.explanation,
  };
  // News never drives Version 1 entries — keep informational only.
  if (news) {
    decision.reasons = [
      ...decision.reasons,
      "News is informational only and does not approve entries.",
    ];
  }
  return decision;
}

function toNewsContext(news?: SymbolNewsAnalysis): AiDecision["newsContext"] {
  if (!news) {
    return {
      overallSentiment: null,
      highestImportance: null,
      sentimentScore: 0,
      explanation: "No news context attached.",
      headlines: [],
    };
  }
  return {
    overallSentiment: news.overallSentiment,
    highestImportance: news.highestImportance,
    sentimentScore: news.sentimentScore,
    explanation: news.explanation,
    headlines: news.items.map((i) => i.headline).slice(0, 3),
  };
}

/**
 * Generate Version 1 structured decisions for every watchlist symbol.
 * U.S. equities only — non-stock symbols are filtered out.
 * Never places orders.
 */
export function generateWatchlistDecisions(input: {
  symbols: string[];
  quotes: AlpacaQuote[];
  barsBySymbol: Record<string, AlpacaBar[]>;
  bars1MinBySymbol?: Record<string, AlpacaBar[]>;
  bars5MinBySymbol?: Record<string, AlpacaBar[]>;
  bars15MinBySymbol?: Record<string, AlpacaBar[]>;
  timeframe?: "1Min" | "5Min" | "15Min";
  /** null = broker clock unavailable (orders blocked; not reported as closed). */
  isMarketOpen: boolean | null;
  nowMs?: number;
  newsBySymbol?: Record<string, SymbolNewsAnalysis>;
  marketCondition?: MarketCondition;
  /** Optional SPY/QQQ bars when marketCondition not precomputed. */
  spyBars5Min?: AlpacaBar[];
  qqqBars5Min?: AlpacaBar[];
  spyBars15Min?: AlpacaBar[];
  qqqBars15Min?: AlpacaBar[];
  /** Symbols that passed universe filters (others marked ineligible). */
  universeEligibleSymbols?: string[];
  openPositionSymbols?: string[];
  pendingEntrySymbols?: string[];
  pendingExitSymbols?: string[];
  reconciliationComplete?: boolean;
}): AiDecision[] {
  const symbols = filterUsStockSymbols(input.symbols);
  const quoteMap = new Map(input.quotes.map((q) => [q.symbol, q]));
  const bars5 = input.bars5MinBySymbol ?? input.barsBySymbol;

  const market =
    input.marketCondition ??
    assessMarketCondition({
      spyBars5Min: input.spyBars5Min,
      qqqBars5Min: input.qqqBars5Min,
      spyBars15Min: input.spyBars15Min,
      qqqBars15Min: input.qqqBars15Min,
    });

  const eligibleSet = new Set(
    (input.universeEligibleSymbols ?? symbols).map((s) => s.toUpperCase()),
  );
  const openSet = new Set(
    (input.openPositionSymbols ?? []).map((s) => s.toUpperCase()),
  );
  const pendingEntry = new Set(
    (input.pendingEntrySymbols ?? []).map((s) => s.toUpperCase()),
  );
  const pendingExit = new Set(
    (input.pendingExitSymbols ?? []).map((s) => s.toUpperCase()),
  );

  return symbols.map((symbol) => {
    const snapshot = buildSnapshot(
      symbol,
      quoteMap.get(symbol),
      bars5[symbol] ?? input.barsBySymbol[symbol] ?? [],
      input.isMarketOpen,
      {
        bars1Min: input.bars1MinBySymbol?.[symbol],
        bars15Min: input.bars15MinBySymbol?.[symbol],
        nowMs: input.nowMs,
      },
    );
    return decideForSymbol(snapshot, input.newsBySymbol?.[symbol], market, {
      universeEligible: eligibleSet.has(symbol.toUpperCase()),
      hasOpenPosition: openSet.has(symbol.toUpperCase()),
      hasPendingEntry: pendingEntry.has(symbol.toUpperCase()),
      hasPendingExit: pendingExit.has(symbol.toUpperCase()),
      reconciliationComplete: input.reconciliationComplete ?? true,
      nowMs: input.nowMs,
    });
  });
}

/** @deprecated prefer generateWatchlistDecisions */
export function generateAiDecision(
  quotes: AlpacaQuote[],
  focusSymbol?: string,
): AiDecision {
  const symbols =
    focusSymbol != null
      ? [focusSymbol.toUpperCase()]
      : quotes.map((q) => q.symbol);
  const decisions = generateWatchlistDecisions({
    symbols: symbols.length > 0 ? symbols : ["N/A"],
    quotes,
    barsBySymbol: {},
    timeframe: "5Min",
    isMarketOpen: false,
  });
  return (
    decisions[0] ?? {
      symbol: "N/A",
      action: "HOLD",
      confidence: 0,
      reasons: ["No data"],
      riskWarnings: ["No market data"],
      riskStatus: "unknown",
      riskLevel: "unknown",
      timestamp: new Date().toISOString(),
      paperOnly: true,
      assetClass: "us_equity",
      dataQuality: {
        isMarketOpen: false,
        isQuoteStale: true,
        spreadPercent: null,
        hasRecentBars: false,
        warningMessages: ["No market data"],
      } satisfies DataQuality,
      readyForManualPaperTrade: false,
      tradeBlockReasons: ["No market data"],
    }
  );
}
