import { NextResponse } from "next/server";
import { learningApiJson } from "@/lib/learning/api-response";
import { listBacktestRuns, readBacktestRun } from "@/lib/backtest/storage";
import { evaluatePromotionEligibility } from "@/lib/backtest/promotion";
import { summarizeWalkForward } from "@/lib/backtest/walk-forward";

export const dynamic = "force-dynamic";

/** GET — list or read backtest runs (read-only; no writes). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (id) {
    const run = await readBacktestRun(id);
    if (!run) {
      return NextResponse.json(
        {
          error: "Backtest run not found",
          paperOnly: true,
          liveTradingAllowed: false,
        },
        { status: 404 },
      );
    }
    const promotion = evaluatePromotionEligibility(run);
    const walkForward = summarizeWalkForward(run.folds);
    return NextResponse.json(
      learningApiJson({
        run: {
          id: run.id,
          createdAt: run.createdAt,
          kind: run.kind,
          strategyVersion: run.strategyVersion,
          parentVersion: run.parentVersion,
          datasetId: run.datasetId,
          symbols: run.symbols,
          timeframe: run.timeframe,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          split: run.split,
          assumptions: run.assumptions,
          dataQuality: run.dataQuality,
          metrics: run.metrics,
          folds: run.folds,
          walkForward,
          tradeCount: run.trades.length,
          promotionEligible: false,
          promotionBlockers: run.promotionBlockers,
          promotion,
          brokerOrdersSubmitted: run.brokerOrdersSubmitted,
          disclaimer: run.disclaimer,
        },
      }),
    );
  }

  const runs = await listBacktestRuns(50);
  return NextResponse.json(
    learningApiJson({
      runs,
      promotionEnabled: false,
      paperOnly: true,
    }),
  );
}
