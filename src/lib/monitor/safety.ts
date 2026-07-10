/**
 * Monitor safety — paper only. Auto trading uses a separate module.
 */

import {
  isAutoPaperTradingEnabled,
  isPaperOrderExecutionEnabled,
  PAPER_TRADING_BASE_URL,
} from "@/lib/config";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "@/lib/alpaca/safety";
import { isAutoTradeRuntimeBlocked } from "@/lib/auto-trade/runtime";

/** Hard guarantees for monitor / auto-trade responses. */
export function monitorSafetyFlags() {
  const autoEnv = isAutoPaperTradingEnabled();
  return {
    paperOnly: true as const,
    canPlaceOrders: false as const,
    /** True only when auto env + execution enabled and runtime not killed. */
    automaticTradingAllowed: autoEnv && isPaperOrderExecutionEnabled(),
    liveTradingAllowed: false as const,
    orderExecutionEnabled: isPaperOrderExecutionEnabled(),
    autoPaperTradingEnvEnabled: autoEnv,
    /** Monitor scanner delegates orders to auto-trade module when enabled. */
    monitorPlacesOrders: false as const,
  };
}

export async function getEffectiveAutoTradingAllowed(): Promise<boolean> {
  if (!isAutoPaperTradingEnabled() || !isPaperOrderExecutionEnabled()) {
    return false;
  }
  return !(await isAutoTradeRuntimeBlocked());
}

export function assertMonitorPaperOnly(): void {
  assertPaperTradingOnly(PAPER_TRADING_BASE_URL);
}

/**
 * Legacy guard — blocks unsupported MONITOR_ALLOW_AUTO_ORDERS bypass.
 * Auto trading must use AUTO_PAPER_TRADING_ENABLED + auto-trade module.
 */
export function assertMonitorCannotTrade(): void {
  assertPaperTradingOnly(PAPER_TRADING_BASE_URL);
  if (process.env.MONITOR_ALLOW_AUTO_ORDERS === "true") {
    throw new PaperTradingSafetyError(
      "MONITOR_ALLOW_AUTO_ORDERS is not supported. Use AUTO_PAPER_TRADING_ENABLED with the auto-trade module.",
    );
  }
}
