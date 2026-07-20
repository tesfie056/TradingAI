/**
 * Pure rules for counting Version 1 completed round trips.
 *
 * Accounting: count on America/New_York market date of the final exit fill.
 * Deduplicate by tradeId.
 */

import { marketDayKey } from "@/lib/market/time";
import type { V1LifecycleTrade } from "@/lib/trading/v1-lifecycle/types";

/**
 * True when a lifecycle trade is a countable Version 1 completed round trip.
 * Does not check trading date — use tradingDateForCompletedTrade separately.
 */
export function isCountableCompletedTrade(trade: V1LifecycleTrade): boolean {
  if (trade.ownership !== "v1_managed") return false;
  if (trade.lifecycleState !== "COMPLETED") return false;
  if (trade.side !== "long") return false;
  if (!(trade.filledEntryQty > 0)) return false;
  if (!(trade.filledExitQty > 0)) return false;
  // Full exit: exit qty covers entry; remaining must be zero
  if (trade.remainingQty > 1e-9) return false;
  if (trade.filledExitQty + 1e-9 < trade.filledEntryQty) return false;
  if (!trade.entryFilledAt) return false;
  if (!trade.exitFilledAt) return false;
  // Realized P/L must be recorded (net preferred; gross acceptable)
  const hasPnL =
    (trade.realizedNetPnL != null && Number.isFinite(trade.realizedNetPnL)) ||
    (trade.realizedGrossPnL != null && Number.isFinite(trade.realizedGrossPnL));
  if (!hasPnL) return false;
  return true;
}

/** U.S. market date (YYYY-MM-DD ET) when the final exit fill occurred. */
export function tradingDateForCompletedTrade(
  trade: V1LifecycleTrade,
): string | null {
  if (!trade.exitFilledAt) return null;
  return marketDayKey(trade.exitFilledAt);
}

export function isCountableForTradingDate(
  trade: V1LifecycleTrade,
  tradingDate: string,
): boolean {
  if (!isCountableCompletedTrade(trade)) return false;
  return tradingDateForCompletedTrade(trade) === tradingDate;
}
