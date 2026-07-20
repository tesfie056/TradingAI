/**
 * Create Version 1 lifecycle trade records (planning → entry candidate).
 */

import { V1_LIFECYCLE_STRATEGY_ID } from "@/lib/trading/v1-lifecycle/config";
import {
  buildClientOrderId,
  newTradeId,
} from "@/lib/trading/v1-lifecycle/client-order-id";
import type { V1LifecycleTrade } from "@/lib/trading/v1-lifecycle/types";

export function createV1CandidateTrade(input: {
  symbol: string;
  strategyVersion: string;
  scanId?: string | null;
  decisionId?: string | null;
  entryDecisionId?: string | null;
  requestedQty: number;
  plannedEntry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  expectedRisk?: number | null;
  rewardToRisk?: number | null;
  nowIso?: string;
}): V1LifecycleTrade {
  const now = input.nowIso ?? new Date().toISOString();
  const tradeId = newTradeId(Date.parse(now) || Date.now());
  const clientOrderId = buildClientOrderId(tradeId, "entry");

  if (!(input.requestedQty > 0)) {
    throw new Error("Version 1 candidate requires positive quantity");
  }
  if (input.stopLoss == null || input.takeProfit == null) {
    throw new Error("Version 1 candidate requires stop-loss and take-profit");
  }
  if (input.plannedEntry != null) {
    if (input.stopLoss >= input.plannedEntry) {
      throw new Error("Long stop-loss must be below entry");
    }
    if (input.takeProfit <= input.plannedEntry) {
      throw new Error("Long take-profit must be above entry");
    }
  }

  return {
    tradeId,
    strategyId: V1_LIFECYCLE_STRATEGY_ID,
    strategyVersion: input.strategyVersion,
    scanId: input.scanId ?? null,
    decisionId: input.decisionId ?? null,
    entryDecisionId: input.entryDecisionId ?? null,
    symbol: input.symbol.trim().toUpperCase(),
    side: "long",
    ownership: "v1_managed",
    clientOrderId,
    requestedQty: input.requestedQty,
    filledEntryQty: 0,
    remainingQty: 0,
    plannedEntry: input.plannedEntry,
    actualAvgEntry: null,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    expectedRisk: input.expectedRisk ?? null,
    rewardToRisk: input.rewardToRisk ?? null,
    entryOrderId: null,
    stopOrderId: null,
    takeProfitOrderId: null,
    exitOrderIds: [],
    lifecycleState: "CANDIDATE_SELECTED",
    transitions: [
      {
        from: "CANDIDATE_SELECTED",
        to: "CANDIDATE_SELECTED",
        at: now,
        reason: "Candidate selected from BUY-qualified Version 1 strategy result",
      },
    ],
    entryRejectionReason: null,
    exitRejectionReason: null,
    exitReason: null,
    protectionStatus: "unknown",
    realizedGrossPnL: null,
    realizedNetPnL: null,
    fees: null,
    holdingDurationMs: null,
    avgExitPrice: null,
    filledExitQty: 0,
    createdAt: now,
    updatedAt: now,
    entrySubmittedAt: null,
    entryFilledAt: null,
    exitSubmittedAt: null,
    exitFilledAt: null,
    completedAt: null,
    lastReconciledAt: null,
    lastBrokerUpdateAt: null,
    paperOnly: true,
    criticalWarnings: [],
  };
}
