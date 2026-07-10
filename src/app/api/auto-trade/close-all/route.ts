import { NextResponse } from "next/server";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { closeAllOpenPositions } from "@/lib/trading/emergency";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/**
 * POST — deliberate close of all open paper positions.
 * Requires { "confirm": true }. Never combined with Emergency Stop.
 */
export async function POST(request: Request) {
  let body: { confirm?: boolean } = {};
  try {
    body = (await request.json()) as { confirm?: boolean };
  } catch {
    body = {};
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Close all requires confirm:true. This is separate from Emergency Stop.",
        ...monitorSafetyFlags(),
      },
      { status: 400 },
    );
  }

  const result = await closeAllOpenPositions();
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: result.closed,
    ...result,
    ...status,
    ...monitorSafetyFlags(),
  });
}
