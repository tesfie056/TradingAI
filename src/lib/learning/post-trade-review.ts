/**
 * Automated post-trade review — separates good decisions from lucky outcomes.
 */

import type { MarketRegime } from "@/lib/learning/regime";
import type {
  TradeReviewClassification,
  TradeReviewRecord,
} from "@/lib/learning/types";
import { appendTradeReview } from "@/lib/learning/dataset";

function newId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type PostTradeReviewInput = {
  decisionId: string;
  symbol: string;
  strategyId: string;
  strategyVersion: string;
  regime: MarketRegime | null;
  /** Planned entry vs fill */
  plannedEntry: number | null;
  fillPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  realizedPnl: number | null;
  mfe: number | null;
  mae: number | null;
  exitReason: string | null;
  /** Whether entry direction/rules matched strategy proposal */
  entryFollowedStrategy: boolean | null;
  /** Whether size respected risk caps when known */
  riskSizingCorrect: boolean | null;
  maxSlippagePct?: number;
};

export function classifyTradeReview(input: {
  entryFollowedStrategy: boolean | null;
  riskSizingCorrect: boolean | null;
  slippageAcceptable: boolean | null;
  realizedPnl: number | null;
}): TradeReviewClassification {
  if (
    input.entryFollowedStrategy == null ||
    input.realizedPnl == null ||
    !Number.isFinite(input.realizedPnl)
  ) {
    return "insufficient_data";
  }
  const processGood =
    input.entryFollowedStrategy === true &&
    input.riskSizingCorrect !== false &&
    input.slippageAcceptable !== false;
  const profitable = input.realizedPnl > 0;
  if (processGood && profitable) return "good_profitable";
  if (processGood && !profitable) return "good_losing";
  if (!processGood && profitable) return "bad_profitable";
  return "bad_losing";
}

export function buildPostTradeReview(
  input: PostTradeReviewInput,
): TradeReviewRecord {
  const maxSlip = input.maxSlippagePct ?? 0.01;
  let slippageAcceptable: boolean | null = null;
  if (
    input.plannedEntry != null &&
    input.fillPrice != null &&
    input.plannedEntry > 0
  ) {
    const slip =
      Math.abs(input.fillPrice - input.plannedEntry) / input.plannedEntry;
    slippageAcceptable = slip <= maxSlip;
  }

  const classification = classifyTradeReview({
    entryFollowedStrategy: input.entryFollowedStrategy,
    riskSizingCorrect: input.riskSizingCorrect,
    slippageAcceptable,
    realizedPnl: input.realizedPnl,
  });

  let exitTiming: TradeReviewRecord["exitTiming"] = "unknown";
  const reason = (input.exitReason ?? "").toLowerCase();
  if (reason.includes("stop") || reason.includes("target") || reason.includes("bracket")) {
    exitTiming = "rule_compliant";
  } else if (reason.includes("early") || reason.includes("manual")) {
    exitTiming = "early";
  } else if (reason.includes("late") || reason.includes("eod")) {
    exitTiming = "late";
  }

  let primaryReason = "Insufficient data for full review.";
  switch (classification) {
    case "good_profitable":
      primaryReason =
        "Process followed strategy/risk rules and trade was profitable.";
      break;
    case "good_losing":
      primaryReason =
        "Process followed rules but outcome lost — not treated as a bad decision.";
      break;
    case "bad_profitable":
      primaryReason =
        "Outcome was profitable but entry/risk/slippage process was flawed.";
      break;
    case "bad_losing":
      primaryReason = "Process issues and losing outcome.";
      break;
    default:
      break;
  }

  const stopTargetAppropriate =
    input.stopLoss != null &&
    input.takeProfit != null &&
    input.plannedEntry != null
      ? input.stopLoss !== input.plannedEntry &&
        input.takeProfit !== input.plannedEntry
      : null;

  return {
    id: newId(),
    decisionId: input.decisionId,
    symbol: input.symbol.toUpperCase(),
    reviewedAt: new Date().toISOString(),
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    regime: input.regime,
    entryFollowedStrategy: input.entryFollowedStrategy,
    riskSizingCorrect: input.riskSizingCorrect,
    slippageAcceptable,
    stopTargetAppropriate,
    mfe: input.mfe,
    mae: input.mae,
    exitTiming,
    primaryReason,
    classification,
    realizedPnl: input.realizedPnl,
    paperOnly: true,
  };
}

export async function recordPostTradeReview(
  input: PostTradeReviewInput,
): Promise<TradeReviewRecord> {
  const review = buildPostTradeReview(input);
  await appendTradeReview(review);
  return review;
}
