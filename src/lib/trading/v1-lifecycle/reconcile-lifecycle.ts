/**
 * Version 1 lifecycle reconciliation (dry-run or apply sync only).
 * Prefers broker truth. Never auto-adopts unknown positions as V1-managed.
 * Never mutates orders/positions in dry-run.
 */

import type { AlpacaOrder, AlpacaPosition } from "@/lib/alpaca/types";
import { classifyPosition } from "@/lib/trading/v1-lifecycle/ownership";
import {
  listActiveV1Trades,
  readV1LifecycleStore,
  upsertV1LifecycleTrade,
} from "@/lib/trading/v1-lifecycle/store";
import { syncTradeFromBroker } from "@/lib/trading/v1-lifecycle/sync";
import type {
  V1LifecycleTrade,
  V1LifecycleWarning,
  V1PositionClassification,
} from "@/lib/trading/v1-lifecycle/types";

export type LifecycleReconcileReport = {
  paperOnly: true;
  dryRun: boolean;
  mutatedOrdersOrPositions: false;
  marketOpen: boolean | null;
  sessionContext: string;
  classifications: V1PositionClassification[];
  activeTrades: V1LifecycleTrade[];
  syncedTrades: V1LifecycleTrade[];
  warnings: V1LifecycleWarning[];
  aaplShortBlocksEntries: boolean;
  missingProtectionTradeIds: string[];
  pauseAutoTradingRecommended: boolean;
  evaluatedAt: string;
};

export async function reconcileV1Lifecycle(input: {
  positions: AlpacaPosition[];
  openOrders: AlpacaOrder[];
  recentOrders: AlpacaOrder[];
  marketOpen: boolean | null;
  sessionContext: string;
  /** When true, only classify + compute sync result without writing store. */
  dryRun: boolean;
}): Promise<LifecycleReconcileReport> {
  const active = await listActiveV1Trades();
  const store = await readV1LifecycleStore();
  const allTrades = store.trades;

  const snap = {
    positions: input.positions,
    openOrders: input.openOrders,
    recentOrders: input.recentOrders,
    nowMs: Date.now(),
  };

  const synced: V1LifecycleTrade[] = [];
  const warnings: V1LifecycleWarning[] = [];

  for (const trade of active) {
    const next = syncTradeFromBroker(trade, snap);
    synced.push(next);
    if (!input.dryRun) {
      await upsertV1LifecycleTrade(next);
    }
    if (next.protectionStatus === "missing") {
      warnings.push({
        level: "critical",
        code: "missing_protection",
        message: `${next.symbol} missing protection`,
        symbol: next.symbol,
        tradeId: next.tradeId,
      });
    }
    if (next.lifecycleState === "RECONCILIATION_REQUIRED") {
      warnings.push({
        level: "critical",
        code: "reconciliation_required",
        message: `${next.symbol} requires reconciliation`,
        symbol: next.symbol,
        tradeId: next.tradeId,
      });
    }
  }

  const classifications = input.positions
    .filter((p) => Number(p.qty) !== 0)
    .map((position) =>
      classifyPosition({
        position,
        v1Trades: synced.length ? synced : allTrades,
        openOrders: input.openOrders,
        recentOrders: input.recentOrders,
      }),
    );

  const aaplShortBlocksEntries = classifications.some((c) => c.isLegacyAaplShort);
  const missingProtectionTradeIds = synced
    .filter((t) => t.protectionStatus === "missing")
    .map((t) => t.tradeId);

  const pauseAutoTradingRecommended =
    aaplShortBlocksEntries === false
      ? classifications.some((c) => c.ownership === "unknown") ||
        missingProtectionTradeIds.length > 0 ||
        synced.some((t) => t.lifecycleState === "RECONCILIATION_REQUIRED")
      : classifications.some((c) => c.ownership === "unknown") ||
        missingProtectionTradeIds.length > 0 ||
        synced.some((t) => t.lifecycleState === "RECONCILIATION_REQUIRED");

  // Legacy AAPL short alone does not force global auto block, but blocks AAPL BUY.
  // Unknown V1 client-id positions do force pause recommendation.

  for (const c of classifications) {
    if (c.isLegacyAaplShort || c.ownership !== "v1_managed") {
      warnings.push({
        level: c.ownership === "unknown" || c.ownership === "orphaned" ? "critical" : "warn",
        code: c.isLegacyAaplShort ? "legacy_aapl_short" : c.ownership,
        message: c.reason,
        symbol: c.symbol,
      });
    }
  }

  return {
    paperOnly: true,
    dryRun: input.dryRun,
    mutatedOrdersOrPositions: false,
    marketOpen: input.marketOpen,
    sessionContext: input.sessionContext,
    classifications,
    activeTrades: active,
    syncedTrades: synced,
    warnings,
    aaplShortBlocksEntries,
    missingProtectionTradeIds,
    pauseAutoTradingRecommended,
    evaluatedAt: new Date().toISOString(),
  };
}
