export type * from "@/lib/backtest/types";
export { evaluateStrategyAt } from "@/lib/backtest/evaluator";
export {
  generateSyntheticBars,
  generateSyntheticRange,
  getHistoricalBars,
  getHistoricalBarsMulti,
  historicalToAlpaca,
  alpacaToHistorical,
  dedupeHistoricalBars,
} from "@/lib/backtest/historical-data";
export { runDataQualityChecks } from "@/lib/backtest/data-quality";
export {
  defaultAssumptions,
  estimateSpreadPct,
  estimateSlippagePct,
  applyEntryCosts,
} from "@/lib/backtest/costs";
export { simulateSymbolPath, resolveSameCandleExit } from "@/lib/backtest/execution";
export {
  validateChronologicalSplit,
  rejectRandomSplit,
  lockOutOfSample,
  assertOutOfSampleImmutable,
  buildDefaultSplit,
  generateWalkForwardWindows,
  filterBarsByIsoRange,
} from "@/lib/backtest/splits";
export { computeMetrics } from "@/lib/backtest/metrics";
export {
  runBacktestEngine,
  runBaselinePaperIntelligenceV1,
  runRealBaselinePaperIntelligenceV1,
} from "@/lib/backtest/engine";
export { evaluatePromotionEligibility } from "@/lib/backtest/promotion";
export { createChallengerDraft } from "@/lib/backtest/challenger";
export {
  ensureRegimeFilterChallenger,
  deriveBlockedRegimesFromChampionTrades,
  REGIME_FILTER_VERSION,
  assertSameDataset,
  challengerDiffFromChampion,
} from "@/lib/backtest/challenger-regime";
export { summarizeWalkForward } from "@/lib/backtest/walk-forward";
export type { WalkForwardSummary } from "@/lib/backtest/walk-forward";
export {
  saveBacktestRun,
  readBacktestRun,
  listBacktestRuns,
} from "@/lib/backtest/storage";
export { downloadHistoricalJob, loadCachedUniverse } from "@/lib/backtest/downloader";
export { buildCoverageInventory, estimateExpectedRthBars } from "@/lib/backtest/coverage";
export { runStressScenarios, assertStressDoesNotImprove } from "@/lib/backtest/stress";
export { analyzeRegimeCoverage, meaningfulRegimeCount } from "@/lib/backtest/regime-coverage";
export { compareChampionChallenger } from "@/lib/backtest/comparison";
export {
  evaluateChallengerShadow,
  recordShadowPair,
  readShadowDecisions,
  summarizeShadowDecisions,
} from "@/lib/backtest/shadow";
export { buildEvidenceChecklist, buildEvidenceChecklistAsync } from "@/lib/backtest/evidence";
export {
  isRealDataOnlyEnv,
  assertNoSyntheticAllowed,
} from "@/lib/backtest/real-data-mode";
export {
  buildRunFingerprint,
  fingerprintFromAssumptions,
  compareFingerprints,
  BACKTEST_ENGINE_VERSION,
} from "@/lib/backtest/fingerprint";
export type { RunFingerprint } from "@/lib/backtest/fingerprint";
export { buildWeaknessReport } from "@/lib/backtest/weakness";
export {
  createTypedExperiment,
  listExperiments,
  assertAcceptanceImmutable,
} from "@/lib/backtest/experiments";
export { getOrBuildDqSummary, listDqSummaries } from "@/lib/backtest/dq-summary";
