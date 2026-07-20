/**
 * Version 1 daily completed-round-trip target — public API.
 * Progress tracking only. Never forces trades or weakens safety.
 */

export {
  V1_DAILY_TARGET_DEFAULT,
  getV1DailyConfig,
  getV1DailyConfigWarnings,
} from "@/lib/trading/v1-daily/config";
export type {
  V1DailyConfig,
  V1DailyConfigWarning,
} from "@/lib/trading/v1-daily/config";

export type {
  V1DailySession,
  V1DailyReport,
  V1CountedTradeSummary,
  V1PnLClass,
  V1TargetFailureReason,
  V1TargetFailureReasonCode,
} from "@/lib/trading/v1-daily/types";

export { classifyRealizedPnL } from "@/lib/trading/v1-daily/classify";
export {
  isCountableCompletedTrade,
  tradingDateForCompletedTrade,
  isCountableForTradingDate,
} from "@/lib/trading/v1-daily/count";

export {
  readV1DailySession,
  writeV1DailySession,
  listV1DailySessionDates,
  readV1DailyLatest,
} from "@/lib/trading/v1-daily/store";

export {
  emptyV1DailySession,
  rebuildV1DailySessionFromTrades,
  loadEntryAttemptsToday,
} from "@/lib/trading/v1-daily/rebuild";

export {
  getOrCreateV1DailySession,
  recordV1CompletedTrade,
  refreshV1DailySessionLiveState,
  rebuildV1DailySession,
  finalizeV1DailySession,
  ensureCurrentV1DailySession,
  getV1DailyStatusSnapshot,
} from "@/lib/trading/v1-daily/session";

export {
  buildTargetFailureReasons,
  safetyBlocksOnly,
  reason,
} from "@/lib/trading/v1-daily/failure-reasons";

export { buildV1DailyReport } from "@/lib/trading/v1-daily/report";

export {
  summarizeCountedTrades,
  partitionActiveTrades,
  applyProgressFields,
} from "@/lib/trading/v1-daily/metrics";
