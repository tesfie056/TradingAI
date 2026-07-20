/**
 * Scanner integration for Version 1 lifecycle monitor.
 * Keeps Alpaca mutation helpers out of scanner.ts source (monitor must not
 * place entry orders; exits are gated by execution + auto flags).
 */

import {
  cancelOrder,
  getOpenOrders,
  getOrders,
  getPositions,
  placePaperOrder,
} from "@/lib/alpaca/client";
import {
  isAutoPaperTradingEnabled,
  isPaperOrderExecutionEnabled,
} from "@/lib/config";
import { minutesUntilRegularClose } from "@/lib/strategy/v1-simple-long";
import { tickV1LifecycleMonitor } from "@/lib/trading/v1-lifecycle/monitor";

/**
 * Sync V1 lifecycle from broker. Submits max-hold/EOD exits only when
 * execution + auto trading are both enabled.
 */
export async function runV1LifecycleScanTick(input: {
  marketOpen: boolean;
}): Promise<void> {
  const [positions, openOrders, recentOrders] = await Promise.all([
    getPositions().catch(() => []),
    getOpenOrders(100).catch(() => []),
    getOrders(100).catch(() => []),
  ]);
  const minutesToClose = input.marketOpen
    ? minutesUntilRegularClose(Date.now())
    : null;
  const allowSubmit =
    isPaperOrderExecutionEnabled() && isAutoPaperTradingEnabled();

  await tickV1LifecycleMonitor({
    positions,
    openOrders,
    recentOrders,
    minutesToClose,
    marketOpen: input.marketOpen,
    allowSubmit,
    placeExit: allowSubmit
      ? async ({ symbol, qty, clientOrderId }) =>
          placePaperOrder({
            symbol,
            qty,
            side: "sell",
            type: "market",
            time_in_force: "day",
            client_order_id: clientOrderId,
          })
      : undefined,
    cancelOrder: allowSubmit
      ? async (orderId) => cancelOrder(orderId)
      : undefined,
  });
}
