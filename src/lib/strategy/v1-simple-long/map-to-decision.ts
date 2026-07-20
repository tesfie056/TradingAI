/**
 * Map V1 strategy result → AiDecision for existing UI / scanner plumbing.
 * Does not submit orders.
 */

import type { AiDecision, DataQuality } from "@/lib/alpaca/types";
import type { V1StrategyResult } from "@/lib/strategy/v1-simple-long/types";

export function v1ResultToAiDecision(
  result: V1StrategyResult,
  dataQuality: DataQuality,
): AiDecision {
  const action =
    result.decision === "BUY" ? ("BUY" as const) : ("HOLD" as const);
  const ready =
    result.decision === "BUY" && result.mandatoryFailed.length === 0;

  return {
    symbol: result.symbol,
    action,
    decisionLabel: result.decision,
    confidence: result.confidence,
    reasons: result.primaryReasons,
    riskWarnings: result.riskWarnings,
    riskStatus:
      result.decision === "SKIP"
        ? "high"
        : result.riskWarnings.length > 0
          ? "medium"
          : "low",
    riskLevel:
      result.decision === "SKIP"
        ? "high"
        : result.riskWarnings.length > 0
          ? "medium"
          : "low",
    timestamp: result.evaluatedAt,
    paperOnly: true,
    assetClass: "us_equity",
    dataQuality,
    scores: {
      technicalScore: result.score,
      newsScore: 0.5,
      marketScore: result.marketSessionOpen ? 0.6 : 0.4,
      riskScore: result.mandatoryFailed.length === 0 ? 0.8 : 0.3,
      liquidityScore:
        result.spreadPercent != null && result.spreadPercent <= 0.005
          ? 0.8
          : 0.4,
      volumeScore:
        result.indicators.volumeRatio != null &&
        result.indicators.volumeRatio >= 1
          ? 0.75
          : 0.4,
      momentumScore:
        result.indicators.trend5MinPct != null &&
        result.indicators.trend5MinPct > 0
          ? 0.7
          : 0.4,
      finalScore: result.score,
      confidence: result.confidence,
    },
    explanation: {
      technical: result.conditions
        .filter((c) => ["trend", "momentum", "volume"].includes(c.category))
        .map((c) => c.explanation)
        .slice(0, 3)
        .join(" "),
      news: "News is informational only — Version 1 does not trade on news.",
      market: result.marketSessionOpen
        ? "Regular session open."
        : "Market closed.",
      risk: result.blockReasons[0] ?? "No major risk block.",
      summary: result.explanation,
    },
    readyForManualPaperTrade: ready,
    tradeBlockReasons:
      result.decision === "BUY" ? [] : result.blockReasons.slice(0, 6),
    metrics: {
      last: result.latestPrice,
      mid: result.latestPrice,
      spreadPct: result.spreadPercent,
      trendPct: result.indicators.trend5MinPct,
      rangePct: result.indicators.rangePct,
      volumeRatio: result.indicators.volumeRatio,
      vwap: result.indicators.vwap,
    },
    v1Strategy: {
      strategyId: result.strategyId,
      strategyVersion: result.strategyVersion,
      decision: result.decision,
      score: result.score,
      buyThreshold: result.buyThreshold,
      watchThreshold: result.watchThreshold,
      confidence: result.confidence,
      suggestedEntry: result.suggestedEntry,
      suggestedStopLoss: result.suggestedStopLoss,
      suggestedTakeProfit: result.suggestedTakeProfit,
      rewardToRisk: result.rewardToRisk,
      mandatoryPassed: result.mandatoryPassed.length,
      mandatoryFailed: result.mandatoryFailed,
      conditionsPassed: result.conditions.filter((c) => c.passed).length,
      conditionsFailed: result.conditions.filter((c) => !c.passed).length,
      conditionDetails: result.conditions.map((c) => ({
        id: c.id,
        name: c.name,
        passed: c.passed,
        mandatory: c.mandatory,
        explanation: c.explanation,
      })),
      primaryReason: result.primaryReasons[0] ?? result.explanation,
      evaluatedAt: result.evaluatedAt,
      planningOnly: true,
    },
  };
}
