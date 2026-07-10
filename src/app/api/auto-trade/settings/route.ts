import { NextResponse } from "next/server";
import { getAutoTradeStatus } from "@/lib/auto-trade/status";
import {
  describeWatchlistSource,
  getRuntimeSettings,
  getSettingsMeta,
  patchRuntimeSettings,
  readSettingsAudit,
} from "@/lib/auto-trade/runtime-settings/service";
import { monitorSafetyFlags } from "@/lib/monitor/safety";

export const dynamic = "force-dynamic";

/** GET — effective runtime settings + meta + recent audit. */
export async function GET() {
  const [settings, status, audit] = await Promise.all([
    getRuntimeSettings(),
    getAutoTradeStatus(),
    readSettingsAudit(30),
  ]);
  const watchlistInfo = describeWatchlistSource(settings);
  // Surface effective watchlist in the settings payload for the drawer.
  const effectiveSettings = {
    ...settings,
    watchlist: watchlistInfo.effective,
  };
  return NextResponse.json({
    ok: true,
    settings: effectiveSettings,
    watchlistInfo,
    meta: getSettingsMeta(),
    engine: status.engine,
    audit,
    ...monitorSafetyFlags(),
  });
}

/** PATCH — update runtime settings (validated, audited, no restart). */
export async function PATCH(request: Request) {
  let body: {
    patch?: Record<string, unknown>;
    reason?: string;
    actor?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await patchRuntimeSettings({
    patch: (body.patch ?? {}) as Parameters<typeof patchRuntimeSettings>[0]["patch"],
    actor: body.actor ?? "ui",
    reason: body.reason ?? "settings_patch",
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        errors: result.errors,
        ...monitorSafetyFlags(),
      },
      { status: 400 },
    );
  }

  const status = await getAutoTradeStatus();
  const watchlistInfo = describeWatchlistSource(result.settings);
  return NextResponse.json({
    ok: true,
    settings: {
      ...result.settings,
      watchlist: watchlistInfo.effective,
    },
    watchlistInfo,
    changedFields: result.changedFields,
    engine: status.engine,
    status,
    ...monitorSafetyFlags(),
  });
}
