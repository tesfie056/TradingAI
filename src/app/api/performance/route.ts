import { NextResponse } from "next/server";
import {
  pruneDecisionHistory,
  readPerformanceHistory,
  summarizePerformance,
} from "@/lib/ai/history";
import { updateDecisionOutcomes } from "@/lib/performance/update-outcomes";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await updateDecisionOutcomes(150);
    await pruneDecisionHistory();
    const history = await readPerformanceHistory(100);
    const summary = summarizePerformance(history);

    return NextResponse.json({
      paperOnly: true,
      orderExecutionEnabled: false,
      liveTradingAllowed: false,
      history,
      summary,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load performance";
    return NextResponse.json(
      {
        error: message,
        paperOnly: true,
        orderExecutionEnabled: false,
        history: [],
        summary: null,
      },
      { status: 500 },
    );
  }
}
