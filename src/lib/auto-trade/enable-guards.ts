/**
 * Server-side guards before enabling Auto Trading.
 * Uses local/runtime state — does not submit orders.
 */

import { getEffectiveRuntimeSettings } from "@/lib/auto-trade/runtime-settings/service";
import { listActiveV1Trades } from "@/lib/trading/v1-lifecycle";
import { readUniverseSnapshot } from "@/lib/universe/service";

export type AutoEnableGuardResult =
  | { ok: true }
  | { ok: false; error: string; code: string };

/**
 * Pure-ish checks for turning Auto Trading ON.
 * Does not enable anything — caller applies the patch when ok.
 */
export async function assertCanEnableAutoTrading(): Promise<AutoEnableGuardResult> {
  const settings = getEffectiveRuntimeSettings();
  if (!settings.executionEnabled) {
    return {
      ok: false,
      code: "execution_off",
      error: "Turn paper execution on before Auto Trading.",
    };
  }

  const active = await listActiveV1Trades();
  const critical = active.some(
    (t) =>
      t.lifecycleState === "MANUAL_INTERVENTION_REQUIRED" ||
      t.lifecycleState === "RECONCILIATION_REQUIRED" ||
      t.criticalWarnings.length > 0,
  );
  if (critical) {
    return {
      ok: false,
      code: "lifecycle_critical",
      error:
        "Critical Version 1 lifecycle warnings must be cleared before Auto Trading can turn on.",
    };
  }

  try {
    const universe = await readUniverseSnapshot();
    if (
      universe &&
      typeof universe.eligibleCount === "number" &&
      universe.eligibleCount === 0
    ) {
      return {
        ok: false,
        code: "zero_eligible",
        error:
          "No eligible symbols — Auto Trading cannot turn on until the watchlist has at least one eligible symbol.",
      };
    }
  } catch {
    // Missing snapshot is not a hard block — UI/scan will refresh later
  }

  return { ok: true };
}
