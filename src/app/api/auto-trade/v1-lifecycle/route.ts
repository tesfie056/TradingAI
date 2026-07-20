/**
 * Version 1 lifecycle status API — paper only, no mutations.
 */

import { NextResponse } from "next/server";
import {
  listActiveV1Trades,
  listCompletedV1Trades,
  readV1LifecycleStore,
  getV1LifecycleConfig,
  V1_LIFECYCLE_STRATEGY_ID,
} from "@/lib/trading/v1-lifecycle";

export const dynamic = "force-dynamic";

export async function GET() {
  const [store, active, completed] = await Promise.all([
    readV1LifecycleStore(),
    listActiveV1Trades(),
    listCompletedV1Trades(),
  ]);
  const cfg = getV1LifecycleConfig();

  const warnings = active.flatMap((t) =>
    t.criticalWarnings.map((message) => ({
      level: "critical" as const,
      tradeId: t.tradeId,
      symbol: t.symbol,
      message,
      state: t.lifecycleState,
    })),
  );

  return NextResponse.json({
    ok: true,
    paperOnly: true,
    strategyId: V1_LIFECYCLE_STRATEGY_ID,
    config: {
      maxHoldMinutes: cfg.maxHoldMinutes,
      entryOrderTimeoutMinutes: cfg.entryOrderTimeoutMinutes,
      eodFlattenMinutes: cfg.eodFlattenMinutes,
      minRewardToRisk: cfg.minRewardToRisk,
    },
    updatedAt: store.updatedAt,
    counts: {
      active: active.length,
      completed: completed.length,
      pendingEntry: active.filter((t) =>
        ["ENTRY_PENDING", "ENTRY_ACCEPTED", "ENTRY_PARTIALLY_FILLED"].includes(
          t.lifecycleState,
        ),
      ).length,
      pendingExit: active.filter((t) =>
        ["EXIT_PENDING", "EXIT_ACCEPTED", "EXIT_PARTIALLY_FILLED"].includes(
          t.lifecycleState,
        ),
      ).length,
      openProtected: active.filter(
        (t) =>
          t.lifecycleState === "POSITION_OPEN" &&
          t.protectionStatus === "active",
      ).length,
      needsIntervention: active.filter((t) =>
        [
          "MANUAL_INTERVENTION_REQUIRED",
          "RECONCILIATION_REQUIRED",
        ].includes(t.lifecycleState),
      ).length,
    },
    active: active.map(summarizeTrade),
    completed: completed.slice(-20).map(summarizeTrade),
    warnings,
  });
}

function summarizeTrade(t: Awaited<ReturnType<typeof listActiveV1Trades>>[number]) {
  return {
    tradeId: t.tradeId,
    symbol: t.symbol,
    lifecycleState: t.lifecycleState,
    strategyVersion: t.strategyVersion,
    requestedQty: t.requestedQty,
    filledEntryQty: t.filledEntryQty,
    remainingQty: t.remainingQty,
    plannedEntry: t.plannedEntry,
    actualAvgEntry: t.actualAvgEntry,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    protectionStatus: t.protectionStatus,
    exitReason: t.exitReason,
    exitStatus: t.lifecycleState.startsWith("EXIT")
      ? t.lifecycleState
      : t.lifecycleState === "COMPLETED"
        ? "COMPLETED"
        : null,
    realizedNetPnL: t.realizedNetPnL,
    holdingDurationMs: t.holdingDurationMs,
    entryOrderId: t.entryOrderId,
    clientOrderId: t.clientOrderId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastBrokerUpdateAt: t.lastBrokerUpdateAt,
    criticalWarnings: t.criticalWarnings,
    transitions: t.transitions.slice(-8),
  };
}
