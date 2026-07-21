import { NextResponse } from "next/server";
import {
  learningApiJson,
  lockNestedSafety,
} from "@/lib/learning/api-response";
import { buildBaselineReport } from "@/lib/learning/baseline-report";
import {
  getLearningDatasetSummary,
  readTradeReviews,
} from "@/lib/learning/dataset";
import { readStrategyRegistry } from "@/lib/strategy/registry";
import { getAutoTradeAnalytics } from "@/lib/performance/auto-trade-analytics";
import { listBacktestRuns, readBacktestRun } from "@/lib/backtest/storage";
import { evaluatePromotionEligibility } from "@/lib/backtest/promotion";
import { summarizeWalkForward } from "@/lib/backtest/walk-forward";
import { buildCoverageInventory } from "@/lib/backtest/coverage";
import { analyzeRegimeCoverage } from "@/lib/backtest/regime-coverage";
import { buildEvidenceChecklistAsync } from "@/lib/backtest/evidence";
import {
  readShadowDecisions,
  summarizeShadowDecisions,
} from "@/lib/backtest/shadow";
import { REGIME_FILTER_VERSION } from "@/lib/backtest/challenger-regime";
import {
  getActiveShadowSession,
  listShadowSessions,
  readShadowSession,
  recoverInterruptedShadowSessions,
  summarizeEvidenceProgress,
} from "@/lib/shadow/session";
import { listExperiments } from "@/lib/backtest/experiments";
import { buildWeaknessReport } from "@/lib/backtest/weakness";

export const dynamic = "force-dynamic";

/** GET — Strategy Lab summary (read-only; no registry writes). */
export async function GET() {
  await recoverInterruptedShadowSessions();
  const [
    baselineRaw,
    dataset,
    registry,
    analytics,
    reviews,
    runIndex,
    coverage,
    shadowRows,
    typedExperiments,
  ] = await Promise.all([
    buildBaselineReport(),
    getLearningDatasetSummary(),
    readStrategyRegistry(),
    getAutoTradeAnalytics(),
    readTradeReviews(100),
    listBacktestRuns(30),
    buildCoverageInventory(),
    readShadowDecisions(2000),
    listExperiments(),
  ]);

  const baseline = lockNestedSafety(baselineRaw);

  const experiments = registry.entries.map((e) => ({
    strategyId: e.strategyId,
    name: e.name,
    version: e.version,
    status: e.status,
    createdAt: e.createdAt,
    parentVersion: e.parentVersion,
    rejectionReason: e.rejectionReason,
  }));

  const realMeta =
    runIndex.find((r) => r.kind === "baseline") ?? runIndex[0] ?? null;
  let latestRun = realMeta ? await readBacktestRun(realMeta.id) : null;
  for (const meta of runIndex) {
    const r = await readBacktestRun(meta.id);
    if (r && r.realDataOnly && !r.syntheticDataUsed) {
      latestRun = r;
      break;
    }
  }

  const walkForward = latestRun
    ? summarizeWalkForward(latestRun.folds)
    : null;
  const promotion = latestRun
    ? evaluatePromotionEligibility(latestRun)
    : null;
  const regimes = latestRun
    ? analyzeRegimeCoverage(latestRun.trades)
    : [];
  const shadow = summarizeShadowDecisions(shadowRows);
  const evidence = await buildEvidenceChecklistAsync(latestRun);
  const weakness =
    latestRun && latestRun.realDataOnly && !latestRun.syntheticDataUsed
      ? buildWeaknessReport(latestRun)
      : null;

  const challengerEntry = registry.entries.find(
    (e) => e.version === REGIME_FILTER_VERSION,
  );

  const activeShadow = await getActiveShadowSession();
  const shadowIndex = await listShadowSessions(20);
  const shadowLoaded = [];
  for (const row of shadowIndex.slice(0, 15)) {
    const s = await readShadowSession(row.sessionId);
    if (s) shadowLoaded.push(s);
  }
  const shadowEvidence = summarizeEvidenceProgress(shadowLoaded);

  const body = learningApiJson({
    baseline,
    dataset,
    experiments,
    analytics: {
      winRate: analytics.winRate,
      placed: analytics.placed,
      skipped: analytics.skipped,
      autoTradePnL: analytics.autoTradePnL,
      bestSymbols: analytics.bestSymbols.slice(0, 5),
      worstSymbols: analytics.worstSymbols.slice(0, 5),
      confidenceVsResult: analytics.confidenceVsResult,
      timeOfDay: analytics.timeOfDay,
    },
    recentReviews: reviews.slice(0, 20).map((r) => ({
      id: r.id,
      symbol: r.symbol,
      classification: r.classification,
      primaryReason: r.primaryReason,
      realizedPnl: r.realizedPnl,
      regime: r.regime,
      reviewedAt: r.reviewedAt,
    })),
    coverage: {
      rows: coverage,
      ready: coverage.filter((r) => r.status === "READY").length,
      total: coverage.length,
    },
    backtest: latestRun
      ? {
          id: latestRun.id,
          kind: latestRun.kind,
          label: latestRun.label,
          realDataOnly: latestRun.realDataOnly,
          syntheticDataUsed: latestRun.syntheticDataUsed,
          strategyVersion: latestRun.strategyVersion,
          periodStart: latestRun.periodStart,
          periodEnd: latestRun.periodEnd,
          datasetId: latestRun.datasetId,
          symbols: latestRun.symbols,
          timeframe: latestRun.timeframe,
          assumptions: latestRun.assumptions,
          dataQuality: latestRun.dataQuality,
          dataQualityStatus: latestRun.dataQualityStatus,
          coveragePercentage: latestRun.coveragePercentage,
          excludedSymbols: latestRun.excludedSymbols,
          sourceBySymbol: latestRun.sourceBySymbol,
          metrics: latestRun.metrics,
          split: latestRun.split,
          folds: latestRun.folds,
          walkForward,
          regimes,
          promotion,
          promotionEnabled: false,
          disclaimer: latestRun.disclaimer,
          runFingerprint: latestRun.runFingerprint,
          comparableNote: latestRun.comparableNote,
          createdAt: latestRun.createdAt,
        }
      : null,
    challenger: challengerEntry
      ? {
          name: challengerEntry.name,
          version: challengerEntry.version,
          status: challengerEntry.status,
          parentVersion: challengerEntry.parentVersion,
          entryRules: challengerEntry.entryRules,
          parameterValues: challengerEntry.parameterValues,
        }
      : null,
    shadow: {
      ...shadow,
      challengerCannotTrade: true,
    },
    liveShadow: {
      active: activeShadow
        ? {
            sessionId: activeShadow.sessionId,
            status: activeShadow.status,
            startedAt: activeShadow.startedAt,
            championVersion: activeShadow.championVersion,
            challengerVersion: activeShadow.challengerVersion,
            scansProcessed: activeShadow.scansProcessed,
            championProposals: activeShadow.championProposals,
            challengerProposals: activeShadow.challengerProposals,
            openSimPositions: activeShadow.openSimPositions,
            missingDataWarnings: activeShadow.missingDataWarnings.slice(-8),
          }
        : null,
      sessions: shadowIndex,
      evidence: shadowEvidence,
    },
    weakness,
    typedExperiments,
    evidence,
    backtestRuns: runIndex,
  });

  return NextResponse.json(body);
}
