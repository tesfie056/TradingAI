import type {
  AiAction,
  AiDecision,
  AlpacaBar,
  AlpacaQuote,
  DataQuality,
  RiskStatus,
  SymbolMarketSnapshot,
} from "@/lib/alpaca/types";
import {
  assessDataQuality,
  WIDE_SPREAD_HOLD_PCT,
} from "@/lib/market/data-quality";
import { newsConfidenceDelta } from "@/lib/news/analyze";
import type { SymbolNewsAnalysis } from "@/lib/news/types";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
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

function applyNewsToDecision(
  decision: AiDecision,
  news: SymbolNewsAnalysis | undefined,
): AiDecision {
  const newsContext = toNewsContext(news);
  const { delta, note } = newsConfidenceDelta(news);
  const reasons = [...decision.reasons];

  if (news?.explanation) {
    reasons.push(`News: ${news.explanation}`);
  }
  if (note) {
    reasons.push(note);
  }

  // Safety HOLDs keep action; news only nudges confidence.
  const confidence = clamp(
    Number((decision.confidence + delta).toFixed(2)),
    0.1,
    0.95,
  );

  return {
    ...decision,
    confidence,
    reasons,
    newsContext,
  };
}

function buildSnapshot(
  symbol: string,
  quote: AlpacaQuote | undefined,
  bars: AlpacaBar[],
  timeframe: "1Min" | "5Min",
  isMarketOpen: boolean,
  nowMs?: number,
): SymbolMarketSnapshot {
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
    nowMs,
  });
  const spreadPct = dataQuality.spreadPercent;

  return {
    symbol,
    bid,
    ask,
    mid,
    last,
    spreadPct,
    bars,
    timeframe,
    quoteTimestamp: quote?.timestamp ?? null,
    dataQuality,
  };
}

function analyzeBars(bars: AlpacaBar[]) {
  if (bars.length < 2) {
    return {
      trendPct: null as number | null,
      rangePct: null as number | null,
      volumeRatio: null as number | null,
      trendLabel: "insufficient bar history" as const,
    };
  }

  const first = bars[0].c;
  const last = bars[bars.length - 1].c;
  const trendPct = first > 0 ? (last - first) / first : null;

  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const midPrice = (high + low) / 2 || last;
  const rangePct = midPrice > 0 ? (high - low) / midPrice : null;

  const volumes = bars.map((b) => b.v).filter((v) => v > 0);
  let volumeRatio: number | null = null;
  if (volumes.length >= 3) {
    const recent = volumes.slice(-3);
    const earlier = volumes.slice(0, -3);
    const base = earlier.length > 0 ? avg(earlier) : avg(volumes);
    volumeRatio = base > 0 ? avg(recent) / base : null;
  }

  let trendLabel: "up" | "down" | "flat" | "insufficient bar history" = "flat";
  if (trendPct == null) trendLabel = "insufficient bar history";
  else if (trendPct > 0.0015) trendLabel = "up";
  else if (trendPct < -0.0015) trendLabel = "down";

  return { trendPct, rangePct, volumeRatio, trendLabel };
}

function forceHoldDecision(
  snapshot: SymbolMarketSnapshot,
  reasons: string[],
  riskWarnings: string[],
  confidence: number,
  metrics: AiDecision["metrics"],
): AiDecision {
  return {
    symbol: snapshot.symbol,
    action: "HOLD",
    confidence,
    reasons,
    riskWarnings,
    riskStatus: "high",
    timestamp: new Date().toISOString(),
    paperOnly: true,
    dataQuality: snapshot.dataQuality,
    metrics,
  };
}

/**
 * Phase 3 heuristic decision for one symbol.
 * Safety guards still force HOLD; news only adjusts confidence.
 * Never places orders.
 */
export function decideForSymbol(
  snapshot: SymbolMarketSnapshot,
  news?: SymbolNewsAnalysis,
): AiDecision {
  const timestamp = new Date().toISOString();
  const reasons: string[] = [];
  const riskWarnings: string[] = [...snapshot.dataQuality.warningMessages];
  const { trendPct, rangePct, volumeRatio, trendLabel } = analyzeBars(
    snapshot.bars,
  );
  const dq = snapshot.dataQuality;

  const baseMetrics: AiDecision["metrics"] = {
    last: snapshot.last,
    mid: snapshot.mid,
    spreadPct: snapshot.spreadPct,
    trendPct,
    rangePct,
    volumeRatio,
  };

  // --- Hard quality gates (no aggressive BUY/SELL) ---
  if (!dq.isMarketOpen) {
    return applyNewsToDecision(
      forceHoldDecision(
        snapshot,
        [
          "Market is closed — defaulting to HOLD (paper only, no auto-trade).",
          "After-hours / closed-session quotes are not used for aggressive signals.",
          ...(snapshot.last != null
            ? [
                `Last observed price $${snapshot.last.toFixed(2)} (informational).`,
              ]
            : []),
        ],
        riskWarnings,
        0.85,
        baseMetrics,
      ),
      news,
    );
  }

  if (dq.isQuoteStale) {
    return applyNewsToDecision(
      forceHoldDecision(
        snapshot,
        [
          "Quote is stale — defaulting to HOLD until a fresh quote arrives.",
          "Aggressive BUY/SELL blocked while quote freshness fails.",
        ],
        riskWarnings,
        0.8,
        baseMetrics,
      ),
      news,
    );
  }

  if (dq.spreadPercent != null && dq.spreadPercent >= WIDE_SPREAD_HOLD_PCT) {
    return applyNewsToDecision(
      forceHoldDecision(
        snapshot,
        [
          `Spread too wide (${(dq.spreadPercent * 100).toFixed(2)}%) — defaulting to HOLD.`,
          "Wide spreads imply poor liquidity / after-hours distortion; no aggressive action.",
        ],
        riskWarnings,
        0.82,
        baseMetrics,
      ),
      news,
    );
  }

  let buyScore = 0;
  let sellScore = 0;

  if (snapshot.last == null || snapshot.last <= 0) {
    return applyNewsToDecision(
      forceHoldDecision(
        snapshot,
        ["No usable last price; defaulting to HOLD (paper only)."],
        [...riskWarnings, "Missing latest price — cannot size a paper signal."],
        0.15,
        baseMetrics,
      ),
      news,
    );
  }

  reasons.push(
    `Last $${snapshot.last.toFixed(2)}` +
      (snapshot.mid != null ? ` · mid $${snapshot.mid.toFixed(2)}` : ""),
  );
  reasons.push("Market open · quote freshness OK for heuristic scoring.");

  if (snapshot.spreadPct == null) {
    riskWarnings.push("Bid/ask incomplete — spread risk unknown.");
  } else {
    const spreadBps = snapshot.spreadPct * 10_000;
    reasons.push(
      `Spread ${(snapshot.spreadPct * 100).toFixed(3)}% (${spreadBps.toFixed(1)} bps)`,
    );
    if (snapshot.spreadPct < 0.001) {
      buyScore += 1;
      reasons.push("Tight spread supports liquidity for a paper BUY bias.");
    } else if (snapshot.spreadPct >= 0.005) {
      reasons.push("Elevated spread — staying cautious (no forced SELL).");
    } else {
      reasons.push("Spread is moderate — neutral on liquidity.");
    }
  }

  if (trendPct == null) {
    riskWarnings.push(
      `Fewer than 2 ${snapshot.timeframe} bars — trend unavailable.`,
    );
  } else {
    reasons.push(
      `${snapshot.timeframe} trend ${trendLabel} (${(trendPct * 100).toFixed(2)}% over ${snapshot.bars.length} bars)`,
    );
    if (trendLabel === "up") buyScore += 2;
    else if (trendLabel === "down") sellScore += 2;
  }

  if (rangePct != null) {
    reasons.push(
      `Range ${(rangePct * 100).toFixed(2)}% across recent ${snapshot.timeframe} bars`,
    );
    if (rangePct > 0.025) {
      riskWarnings.push("Elevated intraday range — volatility risk.");
      buyScore -= 0.5;
      sellScore -= 0.5;
    } else if (rangePct < 0.004) {
      reasons.push("Compressed range — wait for clearer direction.");
    }
  }

  if (volumeRatio != null) {
    reasons.push(`Recent volume vs earlier bars: ${volumeRatio.toFixed(2)}x`);
    if (volumeRatio >= 1.4 && trendLabel === "up") {
      buyScore += 1;
      reasons.push("Rising volume with uptrend supports BUY bias.");
    } else if (volumeRatio >= 1.4 && trendLabel === "down") {
      sellScore += 1;
      reasons.push("Rising volume with downtrend supports SELL bias.");
    } else if (volumeRatio < 0.6) {
      riskWarnings.push("Thin recent volume — signal reliability lower.");
    }
  } else if (snapshot.bars.length > 0) {
    reasons.push("Volume ratio unavailable (insufficient bar sample).");
  }

  if (!dq.hasRecentBars) {
    riskWarnings.push("Bars not recent — reducing conviction.");
    buyScore -= 1;
    sellScore -= 1;
  }

  // Soft news lean on scores (still cannot override later safety — already passed).
  if (news && news.items.length > 0) {
    if (news.sentimentScore >= 0.25) buyScore += 0.5;
    else if (news.sentimentScore <= -0.25) sellScore += 0.5;
  }

  let riskStatus: RiskStatus = "low";
  if (riskWarnings.length >= 3 || (rangePct != null && rangePct > 0.04)) {
    riskStatus = "high";
  } else if (riskWarnings.length >= 1 || (rangePct != null && rangePct > 0.02)) {
    riskStatus = "elevated";
  }

  if (riskStatus === "high") {
    buyScore -= 1.5;
    sellScore -= 1.5;
    reasons.push("High risk status — forcing more conservative stance.");
  }

  let action: AiAction = "HOLD";
  const edge = buyScore - sellScore;
  if (edge >= 1.5 && riskStatus !== "high") {
    action = "BUY";
  } else if (edge <= -1.5 && riskStatus !== "high") {
    action = "SELL";
  } else {
    action = "HOLD";
    reasons.push(
      "Scores not decisive enough — HOLD (paper only, no auto-trade).",
    );
  }

  const magnitude = Math.abs(edge);
  let confidence = 0.4 + magnitude * 0.12;
  if (action === "HOLD") {
    confidence = clamp(0.45 + (1 - magnitude) * 0.1, 0.35, 0.7);
  }
  if (riskStatus === "elevated") confidence *= 0.9;
  if (riskStatus === "high") confidence *= 0.75;
  confidence = clamp(Number(confidence.toFixed(2)), 0.1, 0.92);

  return applyNewsToDecision(
    {
      symbol: snapshot.symbol,
      action,
      confidence,
      reasons,
      riskWarnings,
      riskStatus,
      timestamp,
      paperOnly: true,
      dataQuality: dq,
      metrics: baseMetrics,
    },
    news,
  );
}

/**
 * Generate a structured decision for every watchlist symbol.
 */
export function generateWatchlistDecisions(input: {
  symbols: string[];
  quotes: AlpacaQuote[];
  barsBySymbol: Record<string, AlpacaBar[]>;
  timeframe?: "1Min" | "5Min";
  isMarketOpen: boolean;
  nowMs?: number;
  newsBySymbol?: Record<string, SymbolNewsAnalysis>;
}): AiDecision[] {
  const timeframe = input.timeframe ?? "5Min";
  const quoteMap = new Map(input.quotes.map((q) => [q.symbol, q]));

  return input.symbols.map((symbol) => {
    const snapshot = buildSnapshot(
      symbol,
      quoteMap.get(symbol),
      input.barsBySymbol[symbol] ?? [],
      timeframe,
      input.isMarketOpen,
      input.nowMs,
    );
    return decideForSymbol(snapshot, input.newsBySymbol?.[symbol]);
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
      timestamp: new Date().toISOString(),
      paperOnly: true,
      dataQuality: {
        isMarketOpen: false,
        isQuoteStale: true,
        spreadPercent: null,
        hasRecentBars: false,
        warningMessages: ["No market data"],
      } satisfies DataQuality,
    }
  );
}
