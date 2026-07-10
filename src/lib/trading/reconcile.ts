/**
 * Startup reconciliation — restore broker awareness before new entries.
 * Paper only. Does not place new entry orders.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getAccount,
  getOpenOrders,
  getOrders,
  getPositions,
} from "@/lib/alpaca/client";
import { updateRiskRuntime, type RiskRuntimeState } from "@/lib/risk/runtime";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "reconcile-state.json");

export type OrphanPosition = {
  symbol: string;
  qty: number;
  avgEntry: number | null;
  reason: string;
};

export type ReconcileState = {
  paperOnly: true;
  completedAt: string | null;
  inProgress: boolean;
  openPositionCount: number;
  openOrderCount: number;
  dailyUnrealizedPnL: number;
  orphanedPositions: OrphanPosition[];
  error: string | null;
};

const defaultReconcile = (): ReconcileState => ({
  paperOnly: true,
  completedAt: null,
  inProgress: false,
  openPositionCount: 0,
  openOrderCount: 0,
  dailyUnrealizedPnL: 0,
  orphanedPositions: [],
  error: null,
});

export async function readReconcileState(): Promise<ReconcileState> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as ReconcileState;
    if (parsed?.paperOnly !== true) return defaultReconcile();
    return parsed;
  } catch {
    return defaultReconcile();
  }
}

async function writeReconcileState(state: ReconcileState): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * Reconcile Alpaca paper positions/orders into local risk runtime.
 * Blocks new entries until complete (via riskRuntime.reconciliationComplete).
 */
export async function reconcileTradingState(): Promise<{
  reconcile: ReconcileState;
  risk: RiskRuntimeState;
}> {
  await writeReconcileState({
    ...defaultReconcile(),
    inProgress: true,
  });
  await updateRiskRuntime({ reconciliationComplete: false });

  try {
    const [account, positions, openOrders, recentOrders] = await Promise.all([
      getAccount(),
      getPositions(),
      getOpenOrders(50),
      getOrders(50),
    ]);

    const open = positions.filter((p) => Number(p.qty) !== 0);
    let unrealized = 0;
    for (const p of open) {
      const u = Number(p.unrealized_pl);
      if (Number.isFinite(u)) unrealized += u;
    }

    // Detect orphans: open position with no protective open order (stop/limit/bracket child).
    const protectiveBySymbol = new Set<string>();
    for (const o of openOrders) {
      const t = (o.type ?? "").toLowerCase();
      if (t.includes("stop") || t.includes("limit") || o.order_class === "bracket") {
        protectiveBySymbol.add(o.symbol.toUpperCase());
      }
    }
    // Also check recent filled bracket parents that may have open legs
    for (const o of recentOrders) {
      if (o.order_class === "bracket" && o.status !== "canceled") {
        protectiveBySymbol.add(o.symbol.toUpperCase());
      }
    }

    const orphanedPositions: OrphanPosition[] = [];
    for (const p of open) {
      const sym = p.symbol.toUpperCase();
      if (!protectiveBySymbol.has(sym)) {
        orphanedPositions.push({
          symbol: sym,
          qty: Number(p.qty),
          avgEntry: Number(p.avg_entry_price) || null,
          reason: "Open position without expected stop-loss / take-profit protection",
        });
      }
    }

    const reconcile: ReconcileState = {
      paperOnly: true,
      completedAt: new Date().toISOString(),
      inProgress: false,
      openPositionCount: open.length,
      openOrderCount: openOrders.length,
      dailyUnrealizedPnL: Number(unrealized.toFixed(4)),
      orphanedPositions,
      error: null,
    };
    await writeReconcileState(reconcile);

    const equity = Number(account.equity);
    void equity;

    const risk = await updateRiskRuntime({
      dailyUnrealizedPnL: reconcile.dailyUnrealizedPnL,
      lastReconciledAt: reconcile.completedAt,
      reconciliationComplete: true,
    });

    return { reconcile, risk };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Reconciliation failed";
    const reconcile: ReconcileState = {
      ...defaultReconcile(),
      inProgress: false,
      completedAt: new Date().toISOString(),
      error: message,
    };
    await writeReconcileState(reconcile);
    // Fail closed — do not allow entries if reconcile failed
    const risk = await updateRiskRuntime({
      reconciliationComplete: false,
      lastReconciledAt: reconcile.completedAt,
      entriesPaused: true,
      pauseReason: `Reconciliation failed: ${message}`,
    });
    return { reconcile, risk };
  }
}
