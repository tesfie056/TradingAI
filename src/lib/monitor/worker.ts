/**
 * Bootstraps background monitor worker on server start.
 * Reconciles broker state before allowing new auto entries.
 */

import { isMonitorWorkerAutoStart } from "@/lib/monitor/rate-limit";
import { getMonitorServiceState, startMonitor } from "@/lib/monitor/service";
import { markPaperSessionStarted } from "@/lib/trading/paper-session";
import { reconcileTradingState } from "@/lib/trading/reconcile";
import {
  logUniverseWarnings,
  resolveEligibleUniverse,
} from "@/lib/universe/service";

let reconcileStarted = false;

export async function ensureMonitorWorkerRunning(): Promise<void> {
  if (!reconcileStarted) {
    reconcileStarted = true;
    void reconcileTradingState().catch(() => {
      // fail-closed handled inside reconcile
    });
    // Startup universe check — warn if soak watchlist cannot produce candidates
    void resolveEligibleUniverse()
      .then((u) => {
        if (u.warnings.length > 0) logUniverseWarnings(u.warnings);
      })
      .catch(() => undefined);
  }
  if (!isMonitorWorkerAutoStart()) return;
  const state = getMonitorServiceState();
  if (state.running) return;
  await startMonitor({ worker: true });
  void markPaperSessionStarted();
}

export function resetMonitorWorkerForTests(): void {
  reconcileStarted = false;
}
