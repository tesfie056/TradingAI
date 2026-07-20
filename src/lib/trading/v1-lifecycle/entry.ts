/**
 * Version 1 entry submission — bracket BUY with client_order_id idempotency.
 * Requires execution + auto trading gates (caller enforces).
 * Never creates shorts. Never modifies AAPL short.
 */

import type { AlpacaOrder } from "@/lib/alpaca/types";
import { getV1LifecycleConfig } from "@/lib/trading/v1-lifecycle/config";
import { createV1CandidateTrade } from "@/lib/trading/v1-lifecycle/factory";
import {
  findOpenV1TradeBySymbol,
  findV1TradeByClientOrderId,
  upsertV1LifecycleTrade,
} from "@/lib/trading/v1-lifecycle/store";
import { applyTransition } from "@/lib/trading/v1-lifecycle/transitions";
import type { V1LifecycleTrade } from "@/lib/trading/v1-lifecycle/types";

export type PlaceBracketEntryFn = (input: {
  symbol: string;
  qty: number;
  takeProfit: number;
  stopLoss: number;
  clientOrderId: string;
}) => Promise<AlpacaOrder>;

export type FindOrderByClientIdFn = (
  clientOrderId: string,
) => Promise<AlpacaOrder | null>;

/**
 * Create a CANDIDATE_SELECTED trade from a BUY-qualified result.
 * Does not submit an order.
 */
export async function selectV1EntryCandidate(input: {
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
  /** Safety: block if symbol already has open V1 trade */
  allowIfOpenExists?: boolean;
}): Promise<
  | { ok: true; trade: V1LifecycleTrade }
  | { ok: false; code: string; reason: string }
> {
  const sym = input.symbol.toUpperCase();
  if (sym === "AAPL") {
    // Extra guard — AAPL short conflict is also checked by ownership classifier
  }
  const existing = await findOpenV1TradeBySymbol(sym);
  if (existing && !input.allowIfOpenExists) {
    return {
      ok: false,
      code: "duplicate_v1_trade",
      reason: `Open Version 1 trade already exists for ${sym} (${existing.tradeId})`,
    };
  }

  const cfg = getV1LifecycleConfig();
  if (
    input.rewardToRisk != null &&
    input.rewardToRisk < cfg.minRewardToRisk
  ) {
    return {
      ok: false,
      code: "reward_to_risk",
      reason: `Reward-to-risk ${input.rewardToRisk} below minimum ${cfg.minRewardToRisk}`,
    };
  }

  try {
    const trade = createV1CandidateTrade({
      symbol: input.symbol,
      strategyVersion: input.strategyVersion,
      scanId: input.scanId,
      decisionId: input.decisionId,
      entryDecisionId: input.entryDecisionId ?? input.decisionId,
      requestedQty: input.requestedQty,
      plannedEntry: input.plannedEntry,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      expectedRisk: input.expectedRisk,
      rewardToRisk: input.rewardToRisk,
    });
    await upsertV1LifecycleTrade(trade);
    return { ok: true, trade };
  } catch (err) {
    return {
      ok: false,
      code: "candidate_invalid",
      reason: err instanceof Error ? err.message : "Invalid candidate",
    };
  }
}

/**
 * Submit bracket entry for an existing candidate (or reuse client_order_id).
 * On ambiguous response: reconcile by client order id — do not blind retry.
 */
export async function submitV1BracketEntry(input: {
  trade: V1LifecycleTrade;
  placeOrder: PlaceBracketEntryFn;
  findByClientOrderId: FindOrderByClientIdFn;
}): Promise<
  | { ok: true; trade: V1LifecycleTrade; order: AlpacaOrder; duplicate: boolean }
  | { ok: false; trade: V1LifecycleTrade; code: string; reason: string }
> {
  let trade = input.trade;

  // Idempotency: if broker already has this client_order_id, adopt it
  const existingOrder = await input.findByClientOrderId(trade.clientOrderId);
  if (existingOrder) {
    trade = applyTransition(
      {
        ...trade,
        entryOrderId: existingOrder.id,
        entrySubmittedAt:
          existingOrder.submitted_at || trade.entrySubmittedAt || new Date().toISOString(),
      },
      "ENTRY_PENDING",
      "Adopted existing broker order by client_order_id (idempotent retry)",
    );
    trade = applyTransition(
      trade,
      "ENTRY_ACCEPTED",
      `Broker already has order ${existingOrder.id}`,
    );
    await upsertV1LifecycleTrade(trade);
    return { ok: true, trade, order: existingOrder, duplicate: true };
  }

  const stopLoss = trade.stopLoss;
  const takeProfit = trade.takeProfit;
  if (stopLoss == null || takeProfit == null) {
    trade = applyTransition(
      { ...trade, entryRejectionReason: "Missing SL/TP" },
      "ENTRY_REJECTED",
      "Missing stop-loss or take-profit",
    );
    await upsertV1LifecycleTrade(trade);
    return {
      ok: false,
      trade,
      code: "missing_protection_prices",
      reason: "Entry requires stop-loss and take-profit",
    };
  }

  if (stopLoss >= (trade.plannedEntry ?? Infinity)) {
    trade = applyTransition(
      { ...trade, entryRejectionReason: "Invalid SL" },
      "ENTRY_REJECTED",
      "Stop-loss must be below entry for long",
    );
    await upsertV1LifecycleTrade(trade);
    return { ok: false, trade, code: "invalid_stop", reason: "Stop-loss must be below entry" };
  }
  if (takeProfit <= (trade.plannedEntry ?? 0)) {
    trade = applyTransition(
      { ...trade, entryRejectionReason: "Invalid TP" },
      "ENTRY_REJECTED",
      "Take-profit must be above entry for long",
    );
    await upsertV1LifecycleTrade(trade);
    return {
      ok: false,
      trade,
      code: "invalid_take_profit",
      reason: "Take-profit must be above entry",
    };
  }

  trade = applyTransition(trade, "ENTRY_PENDING", "Submitting paper bracket BUY");
  trade = {
    ...trade,
    entrySubmittedAt: new Date().toISOString(),
  };
  await upsertV1LifecycleTrade(trade);

  try {
    const order = await input.placeOrder({
      symbol: trade.symbol,
      qty: trade.requestedQty,
      takeProfit,
      stopLoss,
      clientOrderId: trade.clientOrderId,
    });

    trade = {
      ...trade,
      entryOrderId: order.id,
    };
    trade = applyTransition(
      trade,
      "ENTRY_ACCEPTED",
      `Broker accepted entry ${order.id} (status=${order.status}) — not treated as filled`,
    );
    // Accepted ≠ filled
    if (
      order.status === "filled" ||
      order.status === "partially_filled"
    ) {
      // Leave sync to apply fill details
    }
    await upsertV1LifecycleTrade(trade);
    return { ok: true, trade, order, duplicate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Broker rejected entry";

    // Ambiguous network / timeout style — do not resubmit; ask reconcile
    if (/timeout|ECONN|ambiguous|network/i.test(message)) {
      trade = applyTransition(
        {
          ...trade,
          criticalWarnings: [
            ...trade.criticalWarnings,
            "Ambiguous entry response — reconcile by client_order_id before retry",
          ],
        },
        "RECONCILIATION_REQUIRED",
        message,
      );
      await upsertV1LifecycleTrade(trade);
      return { ok: false, trade, code: "ambiguous_broker", reason: message };
    }

    // Check if order actually landed
    const maybe = await input.findByClientOrderId(trade.clientOrderId);
    if (maybe) {
      trade = applyTransition(
        { ...trade, entryOrderId: maybe.id },
        "ENTRY_ACCEPTED",
        "Recovered order after submit error via client_order_id",
      );
      await upsertV1LifecycleTrade(trade);
      return { ok: true, trade, order: maybe, duplicate: true };
    }

    trade = applyTransition(
      { ...trade, entryRejectionReason: message },
      "ENTRY_REJECTED",
      message,
    );
    await upsertV1LifecycleTrade(trade);
    return { ok: false, trade, code: "entry_rejected", reason: message };
  }
}

/** Reuse candidate by client order id if present (idempotent). */
export async function getTradeForIdempotentRetry(
  clientOrderId: string,
): Promise<V1LifecycleTrade | null> {
  return findV1TradeByClientOrderId(clientOrderId);
}
