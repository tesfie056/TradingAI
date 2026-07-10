import type { AiAction, RiskStatus } from "@/lib/alpaca/types";
import type { OrderMode } from "@/lib/config";
import type { PaperOrderSide } from "@/lib/trades/types";

export type ParsedPaperOrderBody = {
  symbol: string;
  side: PaperOrderSide;
  orderMode: OrderMode;
  qty?: number;
  notional?: number;
  action?: AiAction;
  riskStatus?: RiskStatus;
  confirmed?: boolean;
  manualApproval?: boolean;
};

function parseRiskStatus(raw: unknown): RiskStatus | undefined {
  const riskRaw =
    typeof raw === "string" ? raw.toLowerCase() : undefined;
  if (
    riskRaw === "low" ||
    riskRaw === "elevated" ||
    riskRaw === "medium" ||
    riskRaw === "high" ||
    riskRaw === "unknown"
  ) {
    return riskRaw === "medium" ? "elevated" : riskRaw;
  }
  return undefined;
}

function parseAction(raw: unknown): AiAction | undefined {
  const actionRaw =
    typeof raw === "string" ? raw.toUpperCase() : undefined;
  if (actionRaw === "BUY" || actionRaw === "SELL" || actionRaw === "HOLD") {
    return actionRaw;
  }
  return undefined;
}

/**
 * Parse preview/submit body. Rejects sending both qty and notional.
 */
export function parsePaperOrderBody(raw: unknown): ParsedPaperOrderBody {
  if (!raw || typeof raw !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  if (!symbol) throw new Error("symbol is required");

  const sideRaw = typeof body.side === "string" ? body.side.toLowerCase() : "";
  if (sideRaw !== "buy" && sideRaw !== "sell") {
    throw new Error('side must be "buy" or "sell"');
  }

  const hasQty = body.qty != null && body.qty !== "";
  const hasNotional = body.notional != null && body.notional !== "";
  if (hasQty && hasNotional) {
    throw new Error("Send qty OR notional, never both");
  }

  const orderModeRaw =
    typeof body.orderMode === "string" ? body.orderMode.toLowerCase() : "";
  let orderMode: OrderMode =
    orderModeRaw === "notional" ? "notional" : "quantity";

  if (hasNotional) orderMode = "notional";
  if (hasQty && !hasNotional) orderMode = "quantity";

  const base = {
    symbol,
    side: sideRaw as PaperOrderSide,
    orderMode,
    action: parseAction(body.action),
    riskStatus: parseRiskStatus(body.riskStatus),
    confirmed: body.confirmed === true,
    manualApproval: body.manualApproval === true,
  };

  if (orderMode === "notional") {
    const notional = Number(body.notional);
    if (!Number.isFinite(notional) || notional <= 0) {
      throw new Error("notional must be a positive number");
    }
    if (hasQty) {
      throw new Error("Send qty OR notional, never both");
    }
    return { ...base, notional };
  }

  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("qty must be a positive number");
  }
  if (hasNotional) {
    throw new Error("Send qty OR notional, never both");
  }

  return { ...base, qty };
}
