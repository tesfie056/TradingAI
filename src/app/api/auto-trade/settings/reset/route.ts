import { NextResponse } from "next/server";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import { resetRuntimeSettings } from "@/lib/auto-trade/runtime-settings/service";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/** POST — restore env-seeded safe defaults. */
export async function POST(request: Request) {
  let body: { confirm?: boolean; reason?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  if (body.confirm !== true) {
    return NextResponse.json(
      {
        ok: false,
        error: "Reset requires confirm:true",
        ...monitorSafetyFlags(),
      },
      { status: 400 },
    );
  }

  const settings = await resetRuntimeSettings({
    actor: "ui",
    reason: body.reason ?? "restore_safe_defaults",
  });
  const status = await getAutoTradeStatus();
  return NextResponse.json({
    ok: true,
    settings,
    engine: status.engine,
    status,
    ...monitorSafetyFlags(),
  });
}
