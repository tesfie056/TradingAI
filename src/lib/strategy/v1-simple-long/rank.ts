/**
 * Deterministic ranking of Version 1 strategy results.
 * Only BUY decisions may enter the executable-candidate list.
 * Never places orders.
 */

import type { V1StrategyResult } from "@/lib/strategy/v1-simple-long/types";

export type V1RankedBuyCandidate = {
  rank: number;
  result: V1StrategyResult;
};

function freshnessScore(r: V1StrategyResult): number {
  if (r.dataAgeMs == null) return 0;
  if (r.dataAgeMs <= 30_000) return 1;
  if (r.dataAgeMs <= 120_000) return 0.6;
  return 0.2;
}

function spreadQuality(r: V1StrategyResult): number {
  if (r.spreadPercent == null) return 0;
  if (r.spreadPercent <= 0.001) return 1;
  if (r.spreadPercent <= 0.003) return 0.7;
  if (r.spreadPercent <= 0.005) return 0.4;
  return 0.1;
}

/**
 * Sort BUY-qualified results only.
 * Order: score → confidence → reward-to-risk → spread quality → freshness → symbol.
 */
export function rankV1BuyCandidates(
  results: V1StrategyResult[],
): V1RankedBuyCandidate[] {
  const buys = results.filter((r) => r.decision === "BUY");
  const sorted = [...buys].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const rrA = a.rewardToRisk ?? 0;
    const rrB = b.rewardToRisk ?? 0;
    if (rrB !== rrA) return rrB - rrA;
    const sq = spreadQuality(b) - spreadQuality(a);
    if (sq !== 0) return sq;
    const fq = freshnessScore(b) - freshnessScore(a);
    if (fq !== 0) return fq;
    return a.symbol.localeCompare(b.symbol);
  });
  return sorted.map((result, i) => ({ rank: i + 1, result }));
}

export function partitionV1Decisions(results: V1StrategyResult[]): {
  buy: V1StrategyResult[];
  watch: V1StrategyResult[];
  skip: V1StrategyResult[];
  hold: V1StrategyResult[];
} {
  return {
    buy: results.filter((r) => r.decision === "BUY"),
    watch: results.filter((r) => r.decision === "WATCH"),
    skip: results.filter((r) => r.decision === "SKIP"),
    hold: results.filter((r) => r.decision === "HOLD"),
  };
}

/** Guard used by tests and ranking — WATCH/SKIP/HOLD never qualify. */
export function isV1ExecutableBuyCandidate(result: V1StrategyResult): boolean {
  return (
    result.decision === "BUY" &&
    result.mandatoryFailed.length === 0 &&
    result.planningOnly === true
  );
}
