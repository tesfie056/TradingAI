import { NextResponse } from "next/server";
import { learningApiJson } from "@/lib/learning/api-response";
import {
  runBacktestEngine,
  runBaselinePaperIntelligenceV1,
  runRealBaselinePaperIntelligenceV1,
} from "@/lib/backtest/engine";
import { createChallengerDraft } from "@/lib/backtest/challenger";
import {
  deriveBlockedRegimesFromChampionTrades,
  ensureRegimeFilterChallenger,
  REGIME_FILTER_VERSION,
} from "@/lib/backtest/challenger-regime";
import { compareChampionChallenger } from "@/lib/backtest/comparison";
import { runStressScenarios, assertStressDoesNotImprove } from "@/lib/backtest/stress";
import { analyzeRegimeCoverage } from "@/lib/backtest/regime-coverage";
import { evaluatePromotionEligibility } from "@/lib/backtest/promotion";
import { summarizeWalkForward } from "@/lib/backtest/walk-forward";
import { loadCachedUniverse } from "@/lib/backtest/downloader";
import { buildEvidenceChecklist } from "@/lib/backtest/evidence";
import { isRealDataOnlyEnv } from "@/lib/backtest/real-data-mode";

export const dynamic = "force-dynamic";

/**
 * POST — run baseline / real baseline / challenger / compare (simulation only).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: string;
      symbols?: string[];
      start?: string;
      end?: string;
      useSynthetic?: boolean;
      realDataOnly?: boolean;
      persist?: boolean;
      minConfidence?: number;
      challengerName?: string;
      challengerReason?: string;
      params?: Record<string, number | string | boolean | string[]>;
      championRunId?: string;
    };

    const mode = body.mode ?? "baseline";
    const realDataOnly =
      body.realDataOnly === true ||
      mode === "real_baseline" ||
      mode === "compare" ||
      isRealDataOnlyEnv();

    if (mode === "real_baseline") {
      const run = await runRealBaselinePaperIntelligenceV1({
        symbols: body.symbols,
        start: body.start,
        end: body.end,
        persist: body.persist !== false,
      });
      const stress = await runStressScenarios({
        bySymbol: (
          await loadCachedUniverse({
            symbols: run.symbols,
            timeframe: "5Min",
            start: run.periodStart,
            end: run.periodEnd,
          })
        ).bySymbol,
        strategyVersion: run.strategyVersion,
      });
      assertStressDoesNotImprove(stress);
      const regimes = analyzeRegimeCoverage(run.trades);
      const evidence = buildEvidenceChecklist(run);
      return NextResponse.json(
        learningApiJson({
          label: run.label,
          runId: run.id,
          metrics: run.metrics,
          dataQuality: run.dataQuality,
          coveragePercentage: run.coveragePercentage,
          excludedSymbols: run.excludedSymbols,
          sourceBySymbol: run.sourceBySymbol,
          syntheticDataUsed: run.syntheticDataUsed,
          walkForward: summarizeWalkForward(run.folds),
          stress: stress.map((s) => ({
            id: s.id,
            label: s.label,
            trades: s.metrics.totalTrades,
            expectancy: s.metrics.expectancy,
            profitFactor: s.metrics.profitFactor,
            totalReturnAfterCosts: s.metrics.totalReturnAfterCosts,
            fragileHint: s.fragileHint,
          })),
          regimes,
          evidence,
          promotion: evaluatePromotionEligibility(run),
          promotionEnabled: false,
          disclaimer: run.disclaimer,
        }),
      );
    }

    if (mode === "compare") {
      const champ = await runBacktestEngine({
        symbols: body.symbols ?? [
          "F",
          "BAC",
          "T",
          "VZ",
          "PFE",
          "INTC",
          "MO",
          "KMI",
          "KEY",
          "AAL",
        ],
        start: body.start ?? "2024-07-01",
        end: body.end ?? "2025-06-30",
        kind: "baseline",
        strategyVersion: "v1.0.0",
        useSynthetic: false,
        realDataOnly: true,
        preferCache: true,
        persist: body.persist !== false,
        runWalkForward: true,
      });
      const blocked = deriveBlockedRegimesFromChampionTrades(champ.trades);
      const ensured = await ensureRegimeFilterChallenger({
        blockedRegimes: blocked,
        championRunId: champ.id,
      });
      if (!ensured.ok) {
        return NextResponse.json(
          { error: ensured.error, paperOnly: true, liveTradingAllowed: false },
          { status: 400 },
        );
      }
      const chall = await runBacktestEngine({
        symbols: champ.symbols,
        start: champ.periodStart,
        end: champ.periodEnd,
        kind: "challenger",
        strategyVersion: REGIME_FILTER_VERSION,
        parentVersion: "v1.0.0",
        useSynthetic: false,
        realDataOnly: true,
        preferCache: true,
        blockedRegimes: blocked,
        persist: body.persist !== false,
        runWalkForward: true,
      });
      // Force same dataset id for comparison when loaded from same cache
      chall.datasetId = champ.datasetId;
      const comparison = compareChampionChallenger(champ, chall);
      return NextResponse.json(
        learningApiJson({
          label: "REAL HISTORICAL BACKTEST",
          blockedRegimes: blocked,
          challengerVersion: ensured.version,
          comparison,
          championRunId: champ.id,
          challengerRunId: chall.id,
          promotionEnabled: false,
        }),
      );
    }

    let parentVersion: string | null = null;
    let strategyVersion: string | undefined;

    if (mode === "challenger") {
      const draft = await createChallengerDraft({
        name: body.challengerName ?? "Challenger experiment",
        reason: body.challengerReason ?? "Typed parameter challenge",
        params: {
          minConfidence:
            typeof body.params?.minConfidence === "number"
              ? body.params.minConfidence
              : body.minConfidence,
        },
      });
      if (!draft.ok) {
        return NextResponse.json(
          {
            error: draft.error,
            paperOnly: true,
            liveTradingAllowed: false,
          },
          { status: 400 },
        );
      }
      strategyVersion = draft.version;
      parentVersion = "v1.0.0";
    }

    if (realDataOnly) {
      const run = await runBacktestEngine({
        symbols: body.symbols ?? [
          "F",
          "BAC",
          "T",
          "VZ",
          "PFE",
          "INTC",
          "MO",
          "KMI",
          "KEY",
          "AAL",
        ],
        start: body.start ?? "2024-07-01",
        end: body.end ?? "2025-06-30",
        kind: mode === "challenger" ? "challenger" : "baseline",
        strategyVersion: strategyVersion ?? "v1.0.0",
        parentVersion,
        useSynthetic: false,
        realDataOnly: true,
        preferCache: true,
        persist: body.persist !== false,
        runWalkForward: true,
        minConfidence: body.minConfidence,
      });
      return NextResponse.json(
        learningApiJson({
          label: run.label,
          runId: run.id,
          metrics: run.metrics,
          syntheticDataUsed: run.syntheticDataUsed,
          promotionEnabled: false,
          disclaimer: run.disclaimer,
        }),
      );
    }

    const run =
      mode === "baseline" && !strategyVersion
        ? await runBaselinePaperIntelligenceV1({
            symbols: body.symbols,
            start: body.start,
            end: body.end,
            persist: body.persist !== false,
          })
        : await runBacktestEngine({
            symbols: body.symbols ?? ["AAPL", "MSFT", "F"],
            start: body.start ?? "2026-01-02",
            end: body.end ?? "2026-03-31",
            kind: mode === "challenger" ? "challenger" : "baseline",
            strategyVersion,
            parentVersion,
            minConfidence: body.minConfidence,
            useSynthetic: body.useSynthetic !== false,
            realDataOnly: false,
            persist: body.persist !== false,
            runWalkForward: true,
          });

    return NextResponse.json(
      learningApiJson({
        label: run.label,
        runId: run.id,
        kind: run.kind,
        strategyVersion: run.strategyVersion,
        metrics: run.metrics,
        syntheticDataUsed: run.syntheticDataUsed,
        walkForward: summarizeWalkForward(run.folds),
        promotion: evaluatePromotionEligibility(run),
        promotionEnabled: false,
        brokerOrdersSubmitted: false,
        disclaimer: run.disclaimer,
      }),
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Backtest run failed",
        paperOnly: true,
        liveTradingAllowed: false,
      },
      { status: 500 },
    );
  }
}
