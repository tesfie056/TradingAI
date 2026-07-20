import { NextResponse } from "next/server";
import { learningApiJson } from "@/lib/learning/api-response";
import { readBacktestRun, listBacktestRuns } from "@/lib/backtest/storage";
import { evaluatePromotionEligibility } from "@/lib/backtest/promotion";

export const dynamic = "force-dynamic";

/**
 * GET — read-only promotion eligibility (promotion actions disabled in I-2).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");

  let run = runId ? await readBacktestRun(runId) : null;
  if (!run) {
    const list = await listBacktestRuns(1);
    if (list[0]) run = await readBacktestRun(list[0].id);
  }

  if (!run) {
    return NextResponse.json(
      learningApiJson({
        promotionEnabled: false,
        eligible: false,
        checks: [],
        manualApprovalRequired: true,
        message: "No backtest run available for eligibility evaluation",
      }),
    );
  }

  const eligibility = evaluatePromotionEligibility(run);
  return NextResponse.json(
    learningApiJson({
      runId: run.id,
      ...eligibility,
      strategyVersion: run.strategyVersion,
      eligible: false,
      promotionEnabled: false,
      message:
        "Promotion remains disabled in Milestone I-2. Eligibility is informational only.",
    }),
  );
}

/** POST promote intentionally rejected. */
export async function POST() {
  return NextResponse.json(
    {
      error: "Promotion is disabled until a later milestone",
      promotionEnabled: false,
      paperOnly: true,
      liveTradingAllowed: false,
    },
    { status: 403 },
  );
}
