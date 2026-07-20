import { NextResponse } from "next/server";
import { learningApiJson } from "@/lib/learning/api-response";
import {
  startShadowSession,
  stopShadowSession,
  getActiveShadowSession,
  listShadowSessions,
  readShadowSession,
  recoverInterruptedShadowSessions,
  summarizeEvidenceProgress,
} from "@/lib/shadow/session";
import { isPaperOrderExecutionEnabled } from "@/lib/config";
import { getEffectiveRuntimeSettings } from "@/lib/auto-trade/runtime-settings/service";

export const dynamic = "force-dynamic";

/** GET — shadow status + evidence (read-only). */
export async function GET(request: Request) {
  await recoverInterruptedShadowSessions();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("sessionId");
  if (id) {
    const session = await readShadowSession(id);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found", paperOnly: true, liveTradingAllowed: false },
        { status: 404 },
      );
    }
    return NextResponse.json(
      learningApiJson({
        session: {
          ...session,
          // do not dump all scans in list view — truncate
          scans: session.scans.slice(-50),
        },
      }),
    );
  }

  const active = await getActiveShadowSession();
  const index = await listShadowSessions(30);
  const loaded = [];
  for (const row of index.slice(0, 20)) {
    const s = await readShadowSession(row.sessionId);
    if (s) loaded.push(s);
  }
  const evidence = summarizeEvidenceProgress(loaded);

  return NextResponse.json(
    learningApiJson({
      active: active
        ? {
            sessionId: active.sessionId,
            status: active.status,
            startedAt: active.startedAt,
            championVersion: active.championVersion,
            challengerVersion: active.challengerVersion,
            scansProcessed: active.scansProcessed,
            championProposals: active.championProposals,
            challengerProposals: active.challengerProposals,
            openSimPositions: active.openSimPositions,
            missingDataWarnings: active.missingDataWarnings.slice(-10),
            runtimeSettingsSnapshot: active.runtimeSettingsSnapshot,
          }
        : null,
      sessions: index,
      evidence,
      challengerBrokerAccess: "blocked",
      note: "Challenger results are simulated and did not submit broker orders.",
    }),
  );
}

/**
 * POST — start/stop shadow. Never enables execution or auto trading.
 * Body: { action: "start" | "stop", challengerVersion?, blockedRegimes? }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      challengerVersion?: string;
      blockedRegimes?: string[];
    };
    const action = body.action ?? "start";
    const settings = getEffectiveRuntimeSettings();
    const executionEnabled = isPaperOrderExecutionEnabled();

    if (action === "start") {
      const session = await startShadowSession({
        challengerVersion: body.challengerVersion,
        blockedRegimes: body.blockedRegimes,
        executionEnabled,
        autoTradingEnabled: settings.autoTradingEnabled === true,
      });
      return NextResponse.json(
        learningApiJson({
          sessionId: session.sessionId,
          status: session.status,
          executionEnabled,
          autoTradingEnabled: settings.autoTradingEnabled === true,
          note: "Shadow started. Execution and auto-trading were NOT changed. Challenger brokerSubmit remains false.",
          challengerBrokerAccess: "blocked",
          brokerSubmit: false,
        }),
      );
    }

    if (action === "stop") {
      const session = await stopShadowSession("STOPPED");
      return NextResponse.json(
        learningApiJson({
          session,
          note: "Shadow stopped. Challenger results are simulated and did not submit broker orders.",
          brokerSubmit: false,
        }),
      );
    }

    return NextResponse.json(
      { error: "Unknown action", paperOnly: true, liveTradingAllowed: false },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Shadow control failed",
        paperOnly: true,
        liveTradingAllowed: false,
      },
      { status: 500 },
    );
  }
}
