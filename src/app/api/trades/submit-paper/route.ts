import { NextResponse } from "next/server";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { isPaperOrderExecutionEnabled } from "@/lib/config";
import { submitManualPaperOrder } from "@/lib/trades/paper-order";
import type { AiAction, RiskStatus } from "@/lib/alpaca/types";
import type { PaperOrderSide } from "@/lib/trades/types";

export const dynamic = "force-dynamic";

function parseBody(raw: unknown): {
  symbol: string;
  side: PaperOrderSide;
  qty: number;
  action?: AiAction;
  riskStatus?: RiskStatus;
  confirmed: boolean;
  manualApproval: boolean;
} {
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

  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("qty must be a positive number");
  }

  const actionRaw =
    typeof body.action === "string" ? body.action.toUpperCase() : undefined;
  const action =
    actionRaw === "BUY" || actionRaw === "SELL" || actionRaw === "HOLD"
      ? actionRaw
      : undefined;

  const riskRaw =
    typeof body.riskStatus === "string" ? body.riskStatus.toLowerCase() : undefined;
  const riskStatus =
    riskRaw === "low" ||
    riskRaw === "elevated" ||
    riskRaw === "medium" ||
    riskRaw === "high" ||
    riskRaw === "unknown"
      ? riskRaw === "medium"
        ? "elevated"
        : riskRaw
      : undefined;

  return {
    symbol,
    side: sideRaw,
    qty,
    action,
    riskStatus,
    confirmed: body.confirmed === true,
    manualApproval: body.manualApproval === true,
  };
}

/**
 * Submit a manually approved paper market order.
 * Never auto-trades. Blocked unless ENABLE_PAPER_ORDER_EXECUTION=true
 * and all safety gates pass.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = parseBody(raw);
    const result = await submitManualPaperOrder(parsed);

    const status = result.submitted ? 200 : 403;
    return NextResponse.json(
      {
        ...result,
        orderExecutionEnabled: isPaperOrderExecutionEnabled(),
        liveTradingAllowed: false,
      },
      { status },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to submit paper order";
    const status = error instanceof PaperTradingSafetyError ? 403 : 400;
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        warning: "PAPER TRADE ONLY",
        submitted: false,
        orderExecutionEnabled: isPaperOrderExecutionEnabled(),
        liveTradingAllowed: false,
      },
      { status },
    );
  }
}
