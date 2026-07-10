/**
 * Position sizing from equity risk rules.
 * Paper only — never places orders.
 */

import { getRiskTradingConfig } from "@/lib/config/risk-config";

export type PositionSizeInput = {
  equity: number;
  entryPrice: number;
  stopLossPrice: number;
  /** Optional override of config. */
  maxRiskPerTradePct?: number;
  maxPositionAllocationPct?: number;
  /** Hard notional cap (e.g. small-account max). */
  maxNotionalCap?: number;
};

export type PositionSizeResult = {
  qty: number;
  notional: number;
  riskAmount: number;
  riskPerShare: number;
  cappedBy: "risk" | "allocation" | "notional_cap" | "none";
};

/**
 * Size a long entry so stop-loss risk ≤ maxRiskPerTradePct of equity,
 * and notional ≤ maxPositionAllocationPct of equity.
 */
export function sizePosition(input: PositionSizeInput): PositionSizeResult {
  const cfg = getRiskTradingConfig();
  const maxRiskPct = input.maxRiskPerTradePct ?? cfg.maxRiskPerTradePct;
  const maxAllocPct =
    input.maxPositionAllocationPct ?? cfg.maxPositionAllocationPct;

  const equity = Math.max(0, input.equity);
  const entry = input.entryPrice;
  const stop = input.stopLossPrice;
  const riskPerShare = Math.abs(entry - stop);

  if (equity <= 0 || entry <= 0 || riskPerShare <= 0) {
    return {
      qty: 0,
      notional: 0,
      riskAmount: 0,
      riskPerShare,
      cappedBy: "none",
    };
  }

  const riskBudget = equity * (maxRiskPct / 100);
  const allocBudget = equity * (maxAllocPct / 100);
  const qtyByRisk = riskBudget / riskPerShare;
  const qtyByAlloc = allocBudget / entry;
  let qty = Math.min(qtyByRisk, qtyByAlloc);
  let cappedBy: PositionSizeResult["cappedBy"] =
    qtyByRisk <= qtyByAlloc ? "risk" : "allocation";

  let notional = qty * entry;
  if (
    input.maxNotionalCap != null &&
    input.maxNotionalCap > 0 &&
    notional > input.maxNotionalCap
  ) {
    qty = input.maxNotionalCap / entry;
    notional = qty * entry;
    cappedBy = "notional_cap";
  }

  // Fractional shares allowed on Alpaca paper for many symbols.
  qty = Number(qty.toFixed(6));
  notional = Number((qty * entry).toFixed(2));
  const riskAmount = Number((qty * riskPerShare).toFixed(4));

  if (qty <= 0) {
    return {
      qty: 0,
      notional: 0,
      riskAmount: 0,
      riskPerShare,
      cappedBy,
    };
  }

  return { qty, notional, riskAmount, riskPerShare, cappedBy };
}
