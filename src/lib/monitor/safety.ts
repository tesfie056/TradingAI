/**
 * Monitor safety — monitoring must never place orders.
 */

import { isPaperOrderExecutionEnabled, PAPER_TRADING_BASE_URL } from "@/lib/config";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "@/lib/alpaca/safety";

/** Hard guarantees for Phase 7 monitor responses. */
export function monitorSafetyFlags() {
  return {
    paperOnly: true as const,
    canPlaceOrders: false as const,
    automaticTradingAllowed: false as const,
    liveTradingAllowed: false as const,
    orderExecutionEnabled: isPaperOrderExecutionEnabled(),
    /** Monitor itself never submits — even if paper execution env is on. */
    monitorPlacesOrders: false as const,
  };
}

export function assertMonitorPaperOnly(): void {
  assertPaperTradingOnly(PAPER_TRADING_BASE_URL);
}

/**
 * Explicit guard: monitor code paths must not call order placement.
 * Throws if somehow invoked with a live trading URL context.
 */
export function assertMonitorCannotTrade(): void {
  assertPaperTradingOnly(PAPER_TRADING_BASE_URL);
  // Defense in depth — monitor never enables auto-submit.
  if (process.env.MONITOR_ALLOW_AUTO_ORDERS === "true") {
    throw new PaperTradingSafetyError(
      "MONITOR_ALLOW_AUTO_ORDERS is not supported. Phase 7 is monitoring only.",
    );
  }
}
