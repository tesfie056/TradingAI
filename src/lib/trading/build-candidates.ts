/**
 * Build ranked candidates from AI decisions + market snapshots.
 */

import type { AiDecision } from "@/lib/alpaca/types";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import { buildLongProposal } from "@/lib/trading/proposal";
import type { RankedCandidate, CandidatesSnapshot } from "@/lib/trading/candidates";
import { saveCandidatesSnapshot } from "@/lib/trading/candidates";

function trendState(lean: number | undefined): string {
  if (lean == null) return "unknown";
  if (lean >= 1.4) return "up";
  if (lean <= -1.4) return "down";
  if (Math.abs(lean) < 0.5) return "flat";
  return "mixed";
}

function momentumState(score: number | undefined): string {
  if (score == null) return "unknown";
  if (score >= 0.7) return "strong";
  if (score >= 0.55) return "moderate";
  if (score <= 0.35) return "weak";
  return "neutral";
}

export function buildRankedCandidates(input: {
  decisions: AiDecision[];
  scannedAt: string;
  universeRejected?: { symbol: string; reasons: string[] }[];
}): CandidatesSnapshot {
  const cfg = getRiskTradingConfig();
  const rejectedMap = new Map(
    (input.universeRejected ?? []).map((r) => [
      r.symbol.toUpperCase(),
      r.reasons.join("; "),
    ]),
  );

  const rows: RankedCandidate[] = input.decisions.map((d) => {
    const price = d.metrics?.last ?? d.metrics?.mid ?? null;
    const spread = d.metrics?.spreadPct ?? d.dataQuality?.spreadPercent ?? null;
    const volRatio = d.metrics?.volumeRatio ?? null;
    const lean =
      d.scores?.momentumScore != null
        ? (d.scores.momentumScore - 0.5) * 4
        : undefined;
    let proposedEntry: number | null = null;
    let stopLoss: number | null = null;
    let takeProfit: number | null = null;
    let riskRewardRatio: number | null = null;
    let qualificationReason: string | null = null;
    let rejectionReason: string | null =
      rejectedMap.get(d.symbol.toUpperCase()) ?? null;
    let qualified = false;

    const actionable =
      d.decisionLabel === "BUY" &&
      Boolean(d.readyForManualPaperTrade) &&
      !rejectionReason;

    if (actionable && price != null && price > 0) {
      const stopPct = cfg.defaultStopLossPct;
      const tpPct = cfg.defaultTakeProfitPct;
      const proposal = buildLongProposal({
        symbol: d.symbol,
        entry: d.v1Strategy?.suggestedEntry ?? price,
        stopLossPct: stopPct,
        takeProfitPct: tpPct,
        confidence: d.confidence,
        strategyName: d.v1Strategy?.strategyId ?? "v1-simple-long",
        reason: d.v1Strategy?.primaryReason ?? d.reasons[0] ?? "BUY signal",
      });
      proposedEntry = d.v1Strategy?.suggestedEntry ?? proposal.proposedEntry;
      stopLoss = d.v1Strategy?.suggestedStopLoss ?? proposal.stopLoss;
      takeProfit = d.v1Strategy?.suggestedTakeProfit ?? proposal.takeProfit;
      const risk = Math.abs(proposedEntry - stopLoss);
      const reward = Math.abs(takeProfit - proposedEntry);
      riskRewardRatio =
        d.v1Strategy?.rewardToRisk ??
        (risk > 0 ? Number((reward / risk).toFixed(3)) : null);
      if (
        riskRewardRatio != null &&
        riskRewardRatio >= 1 &&
        (!d.v1Strategy || d.v1Strategy.mandatoryFailed.length === 0)
      ) {
        qualified = true;
        qualificationReason = `V1 BUY score=${((d.v1Strategy?.score ?? d.confidence) * 100).toFixed(0)}% R:R=${riskRewardRatio}`;
      } else {
        rejectionReason = "Risk/reward below 1.0 or mandatory conditions failed";
      }
    } else if (!rejectionReason) {
      rejectionReason =
        d.tradeBlockReasons?.[0] ??
        (d.decisionLabel === "HOLD"
          ? "HOLD — no entry"
          : d.decisionLabel === "WATCH"
            ? "WATCH — not ready"
            : d.decisionLabel === "SKIP"
              ? "SKIP — blocked this scan"
              : "Not qualified for entry");
    }

    return {
      rank: 0,
      symbol: d.symbol.toUpperCase(),
      currentPrice: price,
      volume: null,
      relativeVolume: volRatio,
      bidAskSpread: spread,
      trendState: trendState(lean),
      momentumState: momentumState(d.scores?.momentumScore),
      volatility:
        d.metrics?.rangePct != null && d.metrics.rangePct > 0.03
          ? "elevated"
          : "normal",
      confidenceScore: Number(d.confidence.toFixed(3)),
      proposedEntry,
      stopLoss,
      takeProfit,
      riskRewardRatio,
      qualificationReason,
      rejectionReason,
      qualified,
      paperOnly: true,
    };
  });

  rows.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    if (b.confidenceScore !== a.confidenceScore) {
      return b.confidenceScore - a.confidenceScore;
    }
    const rr = (b.riskRewardRatio ?? 0) - (a.riskRewardRatio ?? 0);
    if (rr !== 0) return rr;
    return a.symbol.localeCompare(b.symbol);
  });

  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  return {
    scannedAt: input.scannedAt,
    symbolsScanned: ranked.length,
    qualifiedCount: ranked.filter((r) => r.qualified).length,
    candidates: ranked,
    paperOnly: true,
  };
}

export async function persistRankedCandidates(
  input: Parameters<typeof buildRankedCandidates>[0],
): Promise<CandidatesSnapshot> {
  const snapshot = buildRankedCandidates(input);
  await saveCandidatesSnapshot(snapshot);
  return snapshot;
}
