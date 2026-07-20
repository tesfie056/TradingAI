/**
 * Version 1 lifecycle monitor — sync fills, protection, timed/EOD exits.
 * Mutating exits only when allowSubmit is true (execution + auto on).
 * Never mutates legacy AAPL short or external positions.
 */

import type { AlpacaOrder, AlpacaPosition } from "@/lib/alpaca/types";
import { getV1LifecycleConfig } from "@/lib/trading/v1-lifecycle/config";
import {
  needsEntryTimeoutCancel,
  needsEodExit,
  needsMaxHoldExit,
  submitV1ManagedExit,
  type CancelOrderFn,
  type PlaceExitFn,
} from "@/lib/trading/v1-lifecycle/exits";
import { classifyPosition } from "@/lib/trading/v1-lifecycle/ownership";
import {
  listActiveV1Trades,
  upsertV1LifecycleTrade,
} from "@/lib/trading/v1-lifecycle/store";
import {
  syncTradeFromBroker,
  type BrokerSnapshot,
} from "@/lib/trading/v1-lifecycle/sync";
import { applyTransition } from "@/lib/trading/v1-lifecycle/transitions";
import type {
  V1LifecycleTrade,
  V1LifecycleWarning,
  V1PositionClassification,
} from "@/lib/trading/v1-lifecycle/types";

export type MonitorTickInput = {
  positions: AlpacaPosition[];
  openOrders: AlpacaOrder[];
  recentOrders: AlpacaOrder[];
  minutesToClose: number | null;
  marketOpen: boolean;
  /** When false, observe/sync only — no cancel/exit submits. */
  allowSubmit: boolean;
  placeExit?: PlaceExitFn;
  cancelOrder?: CancelOrderFn;
  nowMs?: number;
};

export type MonitorTickResult = {
  trades: V1LifecycleTrade[];
  classifications: V1PositionClassification[];
  warnings: V1LifecycleWarning[];
  /** True when missing protection or recon uncertainty should pause new entries. */
  pauseNewEntries: boolean;
  pauseReason: string | null;
};

export async function tickV1LifecycleMonitor(
  input: MonitorTickInput,
): Promise<MonitorTickResult> {
  const nowMs = input.nowMs ?? Date.now();
  const snap: BrokerSnapshot = {
    positions: input.positions,
    openOrders: input.openOrders,
    recentOrders: input.recentOrders,
    nowMs,
  };

  const active = await listActiveV1Trades();
  const warnings: V1LifecycleWarning[] = [];
  const updated: V1LifecycleTrade[] = [];
  let pauseNewEntries = false;
  let pauseReason: string | null = null;

  for (let trade of active) {
    trade = syncTradeFromBroker(trade, snap);

    // Entry timeout — cancel only V1-owned unfilled entry
    if (
      needsEntryTimeoutCancel(trade, nowMs) &&
      input.allowSubmit &&
      input.cancelOrder &&
      trade.entryOrderId
    ) {
      try {
        await input.cancelOrder(trade.entryOrderId);
        trade = applyTransition(
          trade,
          "ENTRY_CANCELED",
          `Entry timeout after ${getV1LifecycleConfig().entryOrderTimeoutMinutes}m`,
        );
      } catch (err) {
        trade = applyTransition(
          {
            ...trade,
            criticalWarnings: [
              ...trade.criticalWarnings,
              "Entry timeout cancel failed — reconciliation required",
            ],
          },
          "RECONCILIATION_REQUIRED",
          err instanceof Error ? err.message : "Cancel failed",
        );
      }
    } else if (needsEntryTimeoutCancel(trade, nowMs) && !input.allowSubmit) {
      trade = {
        ...trade,
        criticalWarnings: [
          ...trade.criticalWarnings,
          "Entry order timed out but execution disabled — reconcile manually",
        ],
      };
    }

    // Missing protection pauses new entries
    if (
      trade.lifecycleState === "MANUAL_INTERVENTION_REQUIRED" &&
      trade.protectionStatus === "missing"
    ) {
      pauseNewEntries = true;
      pauseReason = `Missing protection on ${trade.symbol} (${trade.tradeId})`;
      warnings.push({
        level: "critical",
        code: "missing_protection",
        message: pauseReason,
        symbol: trade.symbol,
        tradeId: trade.tradeId,
      });
    }

    if (trade.lifecycleState === "RECONCILIATION_REQUIRED") {
      pauseNewEntries = true;
      pauseReason =
        pauseReason ?? `Reconciliation required for ${trade.symbol}`;
      warnings.push({
        level: "critical",
        code: "reconciliation_required",
        message: pauseReason,
        symbol: trade.symbol,
        tradeId: trade.tradeId,
      });
    }

    const pos = input.positions.find(
      (p) => p.symbol.toUpperCase() === trade.symbol,
    );
    const brokerQty = pos ? Number(pos.qty) : 0;

    // Max hold / EOD exits for V1-managed only
    if (
      input.placeExit &&
      (needsMaxHoldExit(trade, nowMs) || needsEodExit(trade, input.minutesToClose))
    ) {
      const reason = needsEodExit(trade, input.minutesToClose)
        ? ("END_OF_DAY_EXIT" as const)
        : ("MAX_HOLD_TIME" as const);

      // Refresh race check after sync
      const result = await submitV1ManagedExit({
        trade,
        reason,
        brokerQty,
        snap,
        placeExit: input.placeExit,
        cancelOpenSells: input.cancelOrder,
        allowSubmit: input.allowSubmit,
      });
      trade = result.trade;
      if (result.ok && result.skipped) {
        // Child may have filled — re-sync
        trade = syncTradeFromBroker(trade, snap);
      } else if (!result.ok && result.code === "execution_disabled") {
        warnings.push({
          level: "critical",
          code: "eod_or_maxhold_unresolved",
          message: result.reason,
          symbol: trade.symbol,
          tradeId: trade.tradeId,
        });
      }
    }

    const prevState = active.find((a) => a.tradeId === trade.tradeId)
      ?.lifecycleState;
    await upsertV1LifecycleTrade(trade);
    if (
      trade.lifecycleState === "COMPLETED" &&
      prevState !== "COMPLETED"
    ) {
      if (trade.realizedNetPnL != null) {
        try {
          const { recordTradeOutcome } = await import("@/lib/risk/runtime");
          await recordTradeOutcome({ pnl: trade.realizedNetPnL });
        } catch {
          // Risk runtime update must not break monitor
        }
      }
      try {
        const { recordV1CompletedTrade } = await import(
          "@/lib/trading/v1-daily"
        );
        await recordV1CompletedTrade(trade);
      } catch {
        // Daily target tracking must not break monitor
      }
    }
    updated.push(trade);
  }

  const classifications = input.positions
    .filter((p) => Number(p.qty) !== 0)
    .map((position) =>
      classifyPosition({
        position,
        v1Trades: updated.length ? updated : active,
        openOrders: input.openOrders,
        recentOrders: input.recentOrders,
      }),
    );

  for (const c of classifications) {
    if (c.isLegacyAaplShort) {
      warnings.push({
        level: "warn",
        code: "legacy_aapl_short",
        message: c.reason,
        symbol: c.symbol,
      });
    } else if (c.ownership === "orphaned" || c.ownership === "unknown") {
      warnings.push({
        level: "critical",
        code: c.ownership,
        message: c.reason,
        symbol: c.symbol,
      });
      if (c.ownership === "unknown") {
        pauseNewEntries = true;
        pauseReason =
          pauseReason ??
          "Unknown position with V1 client id — Auto Trading blocked until reconciled";
      }
    } else if (c.ownership === "external" || c.ownership === "legacy") {
      warnings.push({
        level: "warn",
        code: c.ownership,
        message: c.reason,
        symbol: c.symbol,
      });
    }
  }

  return {
    trades: updated,
    classifications,
    warnings,
    pauseNewEntries,
    pauseReason,
  };
}
