import type { AiAction, DataQuality, RiskStatus } from "@/lib/alpaca/types";
import { WIDE_SPREAD_HOLD_PCT } from "@/lib/market/data-quality";
import type { MarketCondition } from "@/lib/stocks/market-condition";
import { getStrategyConfig } from "@/lib/strategy/version";
import type { StockTechnicalAnalysis } from "@/lib/stocks/technicals";
import type { SymbolNewsAnalysis } from "@/lib/news/types";

export type DecisionLabel = "BUY" | "SELL" | "HOLD" | "WATCH" | "SKIP";

export type DecisionScores = {
  technicalScore: number;
  newsScore: number;
  marketScore: number;
  riskScore: number;
  liquidityScore: number;
  volumeScore: number;
  momentumScore: number;
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

export type RiskAssessment = {
  /** Phase 6.5 display: low / medium / high (maps elevated→medium). */
  level: "low" | "medium" | "high" | "unknown";
  /** Compatibility with existing gates (medium → elevated). */
  riskStatus: RiskStatus;
  reasons: string[];
  riskScore: number;
};

export function newsToScore(news?: SymbolNewsAnalysis): number {
  if (!news || news.items.length === 0) return 0.5;
  // sentimentScore roughly [-1, 1]
  return Number(
    Math.min(0.95, Math.max(0.05, 0.5 + news.sentimentScore * 0.4)).toFixed(3),
  );
}

export function assessStockRisk(input: {
  dataQuality: DataQuality;
  technical: StockTechnicalAnalysis;
  market: MarketCondition;
  news?: SymbolNewsAnalysis;
}): RiskAssessment {
  const reasons: string[] = [];
  let penalty = 0;

  const dq = input.dataQuality;
  if (!dq.isMarketOpen) {
    reasons.push("Market is closed.");
    penalty += 0.45;
  }
  if (dq.isQuoteStale) {
    reasons.push("Quote data is stale.");
    penalty += 0.35;
  }
  if (dq.spreadPercent != null && dq.spreadPercent >= WIDE_SPREAD_HOLD_PCT) {
    reasons.push(
      `Spread too wide (${(dq.spreadPercent * 100).toFixed(2)}%).`,
    );
    penalty += 0.4;
  } else if (dq.spreadPercent == null) {
    reasons.push("Bid/ask spread cannot be measured.");
    penalty += 0.2;
  } else if (dq.spreadPercent >= 0.005) {
    reasons.push("Spread is elevated.");
    penalty += 0.1;
  }

  if (!dq.hasRecentBars) {
    reasons.push("Recent bars are missing or old.");
    penalty += 0.15;
  }

  if (input.technical.volatilityLabel === "extreme") {
    reasons.push("Volatility/range is extreme.");
    penalty += 0.25;
  } else if (input.technical.volatilityLabel === "elevated") {
    reasons.push("Volatility/range is elevated.");
    penalty += 0.12;
  }

  if (input.technical.volumeRatio != null && input.technical.volumeRatio < 0.6) {
    reasons.push("Volume is thin versus recent average.");
    penalty += 0.1;
  }

  if (input.market.label === "choppy" || input.market.label === "unclear") {
    reasons.push("Overall market direction is unclear.");
    penalty += 0.08;
  }

  if (input.news?.highestImportance === "high" && input.news.sentimentScore < -0.3) {
    reasons.push("High-importance negative news.");
    penalty += 0.12;
  }

  const riskScore = Number(Math.min(0.95, Math.max(0.05, 1 - penalty)).toFixed(3));

  let level: RiskAssessment["level"] = "low";
  if (penalty >= 0.45 || riskScore <= 0.4) level = "high";
  else if (penalty >= 0.18 || riskScore <= 0.65) level = "medium";

  if (reasons.length === 0) {
    reasons.push("No major risk flags from quality, spread, or volatility.");
  }

  const riskStatus: RiskStatus =
    level === "high"
      ? "high"
      : level === "medium"
        ? "elevated"
        : level === "low"
          ? "low"
          : "unknown";

  return { level, riskStatus, reasons, riskScore };
}

export function volumeToScore(volumeRatio: number | null): number {
  if (volumeRatio == null) return 0.45;
  if (volumeRatio >= 1.4) return 0.88;
  if (volumeRatio >= 1.0) return 0.72;
  if (volumeRatio >= 0.75) return 0.58;
  if (volumeRatio >= 0.5) return 0.42;
  return 0.25;
}

export function momentumToScore(technicalLean: number): number {
  const abs = Math.abs(technicalLean);
  if (abs >= 2.2) return 0.9;
  if (abs >= 1.6) return 0.78;
  if (abs >= 1.0) return 0.62;
  if (abs >= 0.5) return 0.48;
  return 0.35;
}

export function liquidityToScore(
  spreadPercent: number | null,
  volumeRatio: number | null,
): number {
  let score = 0.55;
  if (spreadPercent != null) {
    if (spreadPercent <= 0.003) score += 0.25;
    else if (spreadPercent <= 0.006) score += 0.12;
    else if (spreadPercent >= WIDE_SPREAD_HOLD_PCT) score -= 0.35;
    else if (spreadPercent >= 0.01) score -= 0.2;
  } else {
    score -= 0.15;
  }
  if (volumeRatio != null && volumeRatio >= 1.0) score += 0.1;
  return Number(Math.min(0.95, Math.max(0.05, score)).toFixed(3));
}

export function buildDecisionScores(input: {
  technicalScore: number;
  newsScore: number;
  marketScore: number;
  riskScore: number;
  volumeScore?: number;
  momentumScore?: number;
  liquidityScore?: number;
}): DecisionScores {
  const { technicalScore, newsScore, marketScore, riskScore } = input;
  const volumeScore = input.volumeScore ?? 0.5;
  const momentumScore = input.momentumScore ?? 0.5;
  const liquidityScore = input.liquidityScore ?? 0.5;
  const w = getStrategyConfig().weights;
  const blended =
    technicalScore * w.technical +
    marketScore * w.market +
    newsScore * w.news +
    riskScore * w.risk +
    volumeScore * w.volume +
    momentumScore * w.momentum +
    liquidityScore * w.liquidity;
  const finalScore = Number(
    Math.min(0.95, Math.max(0.05, blended * (0.7 + 0.3 * riskScore))).toFixed(
      3,
    ),
  );
  const confidence = Number(
    Math.min(0.92, Math.max(0.15, 0.35 + Math.abs(finalScore - 0.5) * 1.1)).toFixed(
      2,
    ),
  );
  return {
    technicalScore,
    newsScore,
    marketScore,
    riskScore,
    liquidityScore,
    volumeScore,
    momentumScore,
    finalScore,
    confidence,
  };
}

/** Phase 11 — human-facing label including WATCH/SKIP. */
export function chooseDecisionLabel(input: {
  action: AiAction;
  blockReasons: string[];
  technicalLean: number;
  finalScore: number;
  smallAccountBlocked?: boolean;
}): DecisionLabel {
  const hardSkip = input.blockReasons.some((r) =>
    /closed|stale|wide|high risk|spread/i.test(r),
  );
  if (hardSkip || input.smallAccountBlocked) return "SKIP";
  if (input.action === "BUY") return "BUY";
  if (input.action === "SELL") return "SELL";
  const lean = Math.abs(input.technicalLean);
  const nearEdge =
    lean >= 1.0 ||
    input.finalScore >= 0.54 ||
    input.finalScore <= 0.46;
  if (nearEdge && input.blockReasons.length > 0) return "WATCH";
  return "HOLD";
}

export function buildExplanation(input: {
  action: AiAction;
  technical: StockTechnicalAnalysis;
  news?: SymbolNewsAnalysis;
  market: MarketCondition;
  risk: RiskAssessment;
}): DecisionExplanation {
  const technical = input.technical.summary;
  const news = input.news?.explanation
    ? input.news.explanation
    : "No useful news context for this stock right now.";
  const market = input.market.explanation;
  const risk = input.risk.reasons.join(" ");

  const summary =
    input.action === "BUY"
      ? `BUY because technicals lean up, market is not weak, and risk is acceptable. ${risk}`
      : input.action === "SELL"
        ? `SELL because technicals lean down with enough clarity. ${risk}`
        : `HOLD because the signal is not clear or safe enough for a paper trade. ${risk}`;

  return { technical, news, market, risk, summary };
}

export function chooseAction(input: {
  technicalLean: number;
  scores: DecisionScores;
  risk: RiskAssessment;
  market: MarketCondition;
  dataQuality: DataQuality;
}): { action: AiAction; blockReasons: string[] } {
  const blockReasons: string[] = [];
  const dq = input.dataQuality;

  if (!dq.isMarketOpen) {
    blockReasons.push("Market is closed.");
  }
  if (dq.isQuoteStale) {
    blockReasons.push("Quote is stale.");
  }
  if (dq.spreadPercent != null && dq.spreadPercent >= WIDE_SPREAD_HOLD_PCT) {
    blockReasons.push("Spread too wide.");
  }
  if (input.risk.level === "high" || input.risk.riskStatus === "high") {
    blockReasons.push("Risk is high.");
  }

  if (blockReasons.length > 0) {
    return { action: "HOLD", blockReasons };
  }

  const lean = input.technicalLean;
  const finalScore = input.scores.finalScore;

  // Avoid BUY when overall market is weak.
  const marketWeak =
    input.market.label === "bearish" || input.market.marketScore < 0.42;
  // Avoid SELL when signal/data is weak or unclear.
  const signalWeak =
    Math.abs(lean) < 1.0 ||
    input.market.label === "unclear" ||
    input.market.label === "choppy" ||
    input.scores.technicalScore > 0.45;

  if (lean >= 1.4 && finalScore >= 0.58 && !marketWeak) {
    return { action: "BUY", blockReasons: [] };
  }
  if (lean <= -1.4 && finalScore <= 0.42 && !signalWeak) {
    return { action: "SELL", blockReasons: [] };
  }

  if (lean >= 1.4 && marketWeak) {
    blockReasons.push("Market is weak — avoiding BUY.");
  }
  if (lean <= -1.4 && signalWeak) {
    blockReasons.push("SELL signal is weak or data is unclear.");
  }
  if (blockReasons.length === 0) {
    blockReasons.push("Scores are not decisive enough for BUY or SELL.");
  }
  return { action: "HOLD", blockReasons };
}

/** Ready for manual paper trade UI when BUY/SELL and risk not high. */
export function isReadyForManualPaperTrade(input: {
  action: AiAction;
  riskStatus: RiskStatus;
  dataQuality?: DataQuality;
}): boolean {
  if (input.action !== "BUY" && input.action !== "SELL") return false;
  if (input.riskStatus === "high") return false;
  const dq = input.dataQuality;
  if (!dq) return false;
  if (!dq.isMarketOpen || dq.isQuoteStale) return false;
  if (dq.spreadPercent != null && dq.spreadPercent >= WIDE_SPREAD_HOLD_PCT) {
    return false;
  }
  if (dq.spreadPercent == null) return false;
  return true;
}
