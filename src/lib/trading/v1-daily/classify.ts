/**
 * Centralized win / loss / breakeven classification for Version 1 daily metrics.
 * Prefer net P/L; fall back to gross when net is unavailable.
 */

import { getV1DailyConfig } from "@/lib/trading/v1-daily/config";
import type { V1PnLClass } from "@/lib/trading/v1-daily/types";

export function classifyRealizedPnL(input: {
  realizedNetPnL: number | null;
  realizedGrossPnL: number | null;
  tolerance?: number;
}): { pnlClass: V1PnLClass; pnlUsed: number | null; usedNet: boolean } {
  const tol = input.tolerance ?? getV1DailyConfig().breakevenTolerance;
  const useNet = input.realizedNetPnL != null && Number.isFinite(input.realizedNetPnL);
  const pnl = useNet
    ? input.realizedNetPnL!
    : input.realizedGrossPnL != null && Number.isFinite(input.realizedGrossPnL)
      ? input.realizedGrossPnL
      : null;

  if (pnl == null) {
    return { pnlClass: "breakeven", pnlUsed: null, usedNet: false };
  }
  if (Math.abs(pnl) <= tol) {
    return { pnlClass: "breakeven", pnlUsed: pnl, usedNet: useNet };
  }
  if (pnl > 0) return { pnlClass: "win", pnlUsed: pnl, usedNet: useNet };
  return { pnlClass: "loss", pnlUsed: pnl, usedNet: useNet };
}
