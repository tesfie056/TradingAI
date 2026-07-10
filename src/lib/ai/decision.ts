import type {
  AiAction,
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
import {
  assessStockRisk,
  buildDecisionScores,
  buildExplanation,
  chooseAction,
  chooseDecisionLabel,
  isReadyForManualPaperTrade,
  liquidityToScore,
  momentumToScore,
  newsToScore,
  volumeToScore,
} from "@/lib/stocks/scoring";
import { isSmallAccountMode } from "@/lib/config";
import { scoreSmallAccountFit } from "@/lib/stocks/small-account";
import {
  analyzeStockTechnicals,
  technicalLeanToScore,
} from "@/lib/stocks/technicals";
import { filterUsStockSymbols } from "@/lib/stocks/universe";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
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

function buildSnapshot(
  symbol: string,
  quote: AlpacaQuote | undefined,
  bars5Min: AlpacaBar[],
  isMarketOpen: boolean,
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

/**
 * Phase 6.5 stock decision for one U.S. equity symbol.
 * Never places orders. Safety HOLDs still win.
 */
export function decideForSymbol(
  snapshot: SymbolMarketSnapshot,
  news?: SymbolNewsAnalysis,
  marketCondition?: MarketCondition,
): AiDecision {
  const timestamp = new Date().toISOString();
  const market = marketCondition ?? defaultMarket();
  const dq = snapshot.dataQuality;

  const technical = analyzeStockTechnicals({
    bars1Min: snapshot.bars1Min,
    bars5Min: snapshot.bars5Min ?? snapshot.bars,
    bars15Min: snapshot.bars15Min,
    lastPrice: snapshot.last,
  });

  const risk = assessStockRisk({
    dataQuality: dq,
    technical,
    market,
    news,
  });

  const technicalScore = technicalLeanToScore(technical.technicalLean);
  const newsScore = newsToScore(news);
  const volumeScore = volumeToScore(technical.volumeRatio);
  const momentumScore = momentumToScore(technical.technicalLean);
  const liquidityScore = liquidityToScore(
    snapshot.spreadPct,
    technical.volumeRatio,
  );
  const scores = buildDecisionScores({
    technicalScore,
    newsScore,
    marketScore: market.marketScore,
    riskScore: risk.riskScore,
    volumeScore,
    momentumScore,
    liquidityScore,
  });

  let adjustedFinalScore = scores.finalScore;
  let smallAccountNote = "";
  const smallAccountBlock: string[] = [];
  if (isSmallAccountMode()) {
    const fit = scoreSmallAccountFit({
      lastPrice: snapshot.last,
      spreadPercent: snapshot.spreadPct,
      volumeRatio: technical.volumeRatio,
      trendPct:
        technical.trends.find((t) => t.timeframe === "5Min")?.trendPct ?? null,
    });
    adjustedFinalScore = clamp(
      adjustedFinalScore + fit.bonus,
      0.05,
      0.95,
    );
    if (fit.reasons.length > 0) {
      smallAccountNote = ` Small-account fit: ${fit.reasons.join("; ")}.`;
    }
    if (!fit.eligible) {
      smallAccountBlock.push("Outside small-account price/quality filters.");
    }
  }

  const scoresForAction = {
    ...scores,
    finalScore: adjustedFinalScore,
  };

  const { action, blockReasons } = chooseAction({
    technicalLean: technical.technicalLean,
    scores: scoresForAction,
    risk,
    market,
    dataQuality: dq,
  });

  const mergedBlockReasons = [...smallAccountBlock, ...blockReasons];

  const decisionLabel = chooseDecisionLabel({
    action,
    blockReasons: mergedBlockReasons,
    technicalLean: technical.technicalLean,
    finalScore: scoresForAction.finalScore,
    smallAccountBlocked: smallAccountBlock.length > 0,
  });

  // Align confidence with action clarity
  let confidence = scores.confidence;
  if (action === "HOLD") {
    confidence = clamp(0.4 + (1 - Math.abs(scores.finalScore - 0.5)) * 0.15, 0.3, 0.75);
  } else {
    confidence = clamp(0.5 + Math.abs(scores.finalScore - 0.5) * 0.9, 0.45, 0.9);
  }
  if (risk.level === "medium") confidence *= 0.92;
  if (risk.level === "high") confidence *= 0.75;
  confidence = clamp(Number(confidence.toFixed(2)), 0.1, 0.92);

  const explanation = buildExplanation({
    action,
    technical,
    news,
    market,
    risk,
  });

  const reasons: string[] = [
    explanation.summary,
    `Technical: ${explanation.technical}`,
    `Market: ${explanation.market}`,
    `News: ${explanation.news}`,
    `Risk: ${explanation.risk}`,
  ];
  if (mergedBlockReasons.length > 0 && action === "HOLD") {
    reasons.push(`Blocked: ${mergedBlockReasons.join(" ")}`);
  }
  if (smallAccountNote) {
    reasons.push(smallAccountNote.trim());
  }

  const trendPct =
    technical.trends.find((t) => t.timeframe === "5Min")?.trendPct ??
    technical.trends.find((t) => t.trendPct != null)?.trendPct ??
    null;

  const ready =
    isReadyForManualPaperTrade({
      action,
      riskStatus: risk.riskStatus,
      dataQuality: dq,
    }) && smallAccountBlock.length === 0;

  const marketPayload: NonNullable<AiDecision["marketCondition"]> = {
    label: market.label as MarketConditionLabel,
    marketScore: market.marketScore,
    spyTrendPct: market.spyTrendPct,
    qqqTrendPct: market.qqqTrendPct,
    explanation: market.explanation,
  };

  return {
    symbol: snapshot.symbol,
    action: action as AiAction,
    decisionLabel,
    confidence,
    reasons,
    riskWarnings: [...dq.warningMessages, ...risk.reasons],
    riskStatus: risk.riskStatus,
    riskLevel: risk.level,
    timestamp,
    paperOnly: true,
    assetClass: "us_equity",
    dataQuality: dq,
    newsContext: toNewsContext(news),
    scores: {
      ...scoresForAction,
      confidence,
    },
    explanation,
    marketCondition: marketPayload,
    readyForManualPaperTrade: ready,
    tradeBlockReasons:
      ready
        ? []
        : mergedBlockReasons.length > 0
          ? mergedBlockReasons
          : risk.reasons,
    metrics: {
      last: snapshot.last,
      mid: snapshot.mid,
      spreadPct: snapshot.spreadPct,
      trendPct,
      rangePct: technical.rangePct,
      volumeRatio: technical.volumeRatio,
      vwap: technical.vwap,
      support: technical.support,
      resistance: technical.resistance,
      gapPct: technical.gapPct,
      gapLabel: technical.gapLabel,
    },
  };
}

/**
 * Generate structured stock decisions for every watchlist symbol.
 * U.S. equities only — non-stock symbols are filtered out.
 */
export function generateWatchlistDecisions(input: {
  symbols: string[];
  quotes: AlpacaQuote[];
  barsBySymbol: Record<string, AlpacaBar[]>;
  bars1MinBySymbol?: Record<string, AlpacaBar[]>;
  bars5MinBySymbol?: Record<string, AlpacaBar[]>;
  bars15MinBySymbol?: Record<string, AlpacaBar[]>;
  timeframe?: "1Min" | "5Min" | "15Min";
  isMarketOpen: boolean;
  nowMs?: number;
  newsBySymbol?: Record<string, SymbolNewsAnalysis>;
  marketCondition?: MarketCondition;
  /** Optional SPY/QQQ bars when marketCondition not precomputed. */
  spyBars5Min?: AlpacaBar[];
  qqqBars5Min?: AlpacaBar[];
  spyBars15Min?: AlpacaBar[];
  qqqBars15Min?: AlpacaBar[];
}): AiDecision[] {
  const symbols = filterUsStockSymbols(input.symbols);
  const quoteMap = new Map(input.quotes.map((q) => [q.symbol, q]));
  const bars5 =
    input.bars5MinBySymbol ?? input.barsBySymbol;

  const market =
    input.marketCondition ??
    assessMarketCondition({
      spyBars5Min: input.spyBars5Min,
      qqqBars5Min: input.qqqBars5Min,
      spyBars15Min: input.spyBars15Min,
      qqqBars15Min: input.qqqBars15Min,
    });

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
    return decideForSymbol(snapshot, input.newsBySymbol?.[symbol], market);
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
