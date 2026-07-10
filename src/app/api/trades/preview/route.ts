import { NextResponse } from "next/server";
import { PaperTradingSafetyError } from "@/lib/alpaca/safety";
import { isPaperOrderExecutionEnabled } from "@/lib/config";
import { buildPaperOrderPreview } from "@/lib/trades/paper-order";
import type { AiAction, RiskStatus } from "@/lib/alpaca/types";
import type { PaperOrderSide } from "@/lib/trades/types";

export const dynamic = "force-dynamic";

function parseBody(raw: unknown): {
  symbol: string;
  side: PaperOrderSide;
  qty: number;
  action?: AiAction;
  riskStatus?: RiskStatus;
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
  };
}

/** Build a paper order preview — never places an order. */
export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = parseBody(raw);
    const preview = await buildPaperOrderPreview(parsed);

    return NextResponse.json({
      ...preview,
      orderExecutionEnabled: isPaperOrderExecutionEnabled(),
      liveTradingAllowed: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to preview paper order";
    const status = error instanceof PaperTradingSafetyError ? 403 : 400;
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        warning: "PAPER TRADE ONLY",
        orderExecutionEnabled: isPaperOrderExecutionEnabled(),
        liveTradingAllowed: false,
      },
      { status },
    );
  }
}
