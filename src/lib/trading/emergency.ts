/**
 * Emergency stop vs close-all — deliberately separated.
 * Paper only.
 */

import {
  cancelAllOrders,
  closeAllPositions,
  getOpenOrders,
  getPositions,
} from "@/lib/alpaca/client";
import { activatePanicStop } from "@/lib/auto-trade/runtime";
import { appendAutoTradeLog } from "@/lib/auto-trade/logs";
import { updateRiskRuntime } from "@/lib/risk/runtime";

export type EmergencyStopResult = {
  paperOnly: true;
  panicActivated: true;
  pendingEntriesCanceled: number;
  openPositionsPreserved: number;
  openPositionSymbols: string[];
  message: string;
};

/**
 * Emergency Stop:
 * - Prevents all new orders (panic)
 * - Disables execution + auto trading immediately
 * - Cancels pending entry orders
 * - Preserves open positions by default
 */
export async function activateEmergencyStop(): Promise<EmergencyStopResult> {
  await activatePanicStop();
  await updateRiskRuntime({
    entriesPaused: true,
    pauseReason: "Emergency stop — new entries blocked",
  });

  const { setExecutionEnabled, setAutoTradingEnabled } = await import(
    "@/lib/auto-trade/runtime-settings/service"
  );
  await setExecutionEnabled(false, "emergency_stop");
  await setAutoTradingEnabled(false, "emergency_stop");

  let pendingEntriesCanceled = 0;
  try {
    const open = await getOpenOrders(100);
    if (open.length > 0) {
      await cancelAllOrders();
      pendingEntriesCanceled = open.length;
    }
  } catch {
    // Still panic even if cancel fails
  }

  const positions = await getPositions().catch(() => []);
  const open = positions.filter((p) => Number(p.qty) !== 0);
  const symbols = open.map((p) => p.symbol.toUpperCase());

  await appendAutoTradeLog({
    event: "panic_stop_activated",
    level: "error",
    message: `Emergency stop: canceled ${pendingEntriesCanceled} pending order(s); ${open.length} position(s) remain open; execution and auto trading disabled`,
    meta: {
      pendingEntriesCanceled,
      openPositionsPreserved: open.length,
    },
  });

  return {
    paperOnly: true,
    panicActivated: true,
    pendingEntriesCanceled,
    openPositionsPreserved: open.length,
    openPositionSymbols: symbols,
    message:
      open.length > 0
        ? `Emergency stop active. ${open.length} open position(s) preserved. Execution and auto trading are OFF. Use Close all positions separately if you want to flatten.`
        : "Emergency stop active. No open positions. Execution and auto trading are OFF.",
  };
}

export type CloseAllResult = {
  paperOnly: true;
  closed: boolean;
  message: string;
  error?: string;
};

/**
 * Deliberate flatten — never combined with Emergency Stop.
 * Requires confirm: true from the API caller.
 */
export async function closeAllOpenPositions(): Promise<CloseAllResult> {
  try {
    await closeAllPositions();
    await appendAutoTradeLog({
      event: "auto_trading_stopped",
      level: "warn",
      message: "All open paper positions close requested (deliberate close-all)",
    });
    return {
      paperOnly: true,
      closed: true,
      message: "Close-all submitted for open paper positions.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Close-all failed";
    return {
      paperOnly: true,
      closed: false,
      message: "Close-all failed",
      error: message,
    };
  }
}

/** Clear panic after deliberate acknowledgment. */
export async function clearEmergencyStop(): Promise<void> {
  const { clearPanicStop } = await import("@/lib/auto-trade/runtime");
  await clearPanicStop();
  await updateRiskRuntime({
    entriesPaused: false,
    pauseReason: null,
  });
  await appendAutoTradeLog({
    event: "auto_trading_resumed",
    message:
      "Emergency / panic stop cleared — engine remains paused; re-enable Execution and Auto Trading separately, then Resume Engine",
  });
}
