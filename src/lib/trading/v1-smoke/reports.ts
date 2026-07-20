/**
 * Persist Version 1 smoke / soak reports under data/v1-soak/.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { getTradingDataDir } from "@/lib/paths/data-root";
import type {
  V1SmokePreflightReport,
  V1SmokeResultReport,
} from "@/lib/trading/v1-smoke/types";

export function v1SoakDir(): string {
  return path.join(getTradingDataDir(), "v1-soak");
}

export function v1SoakDailyDir(): string {
  return path.join(v1SoakDir(), "daily");
}

export async function savePreflightReport(
  report: V1SmokePreflightReport,
): Promise<string> {
  const dir = v1SoakDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `preflight-${report.tradingDate}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}

export async function saveSmokeResultReport(
  report: V1SmokeResultReport,
): Promise<string> {
  const dir = v1SoakDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `smoke-result-${report.tradingDate}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}

export type V1SoakDailyReport = {
  paperOnly: true;
  date: string;
  marketSession: string;
  runtimeDurationMinutes: number | null;
  strategyId: string;
  strategyVersion: string;
  watchlist: string[];
  eligibleSymbolsByScan: number[];
  decisionCounts: {
    BUY: number;
    WATCH: number;
    SKIP: number;
    HOLD: number;
  };
  entryAttempts: number;
  filledEntries: number;
  completedRoundTrips: number;
  dailyGoalResult: string;
  wins: number;
  losses: number;
  breakeven: number;
  grossRealizedPnl: number | null;
  netRealizedPnl: number | null;
  openUnresolvedTrades: number;
  entryRejectionReasons: string[];
  exitReasons: string[];
  safetyBlocks: string[];
  dailyLossStatus: string;
  consecutiveLossStatus: string;
  maximumTradesStatus: string;
  emergencyActions: string[];
  reconciliationCorrections: string[];
  dataOutages: string[];
  brokerErrors: string[];
  aaplLegacyStatus: string;
  operatorNotes: string[];
  status: "preliminary" | "final" | "template";
};

export type V1SoakAggregateReport = {
  paperOnly: true;
  disclaimer: "Paper results do not prove future profitability.";
  totalTradingDays: number;
  daysWithNoQualifiedTrade: number;
  totalEntryAttempts: number;
  totalFilledEntries: number;
  totalCompletedRoundTrips: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  grossPnl: number | null;
  netPnl: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  maximumDailyLoss: number | null;
  maximumDrawdown: number | null;
  stopLossExits: number;
  takeProfitExits: number;
  maxHoldExits: number;
  eodExits: number;
  rejectedEntries: number;
  partialFills: number;
  reconciliationEvents: number;
  missingProtectionIncidents: number;
  duplicateOrderIncidents: number;
  unresolvedPositionIncidents: number;
  dailyTargetReachedCount: number;
  dailyTargetMissedCount: number;
  targetMissReasons: string[];
  strategyVersion: string;
  configurationChanges: string[];
  dataLimitations: string[];
  finalSafetyVerdict: string;
  operationalReadinessVerdict: string;
  stageACompleted: boolean;
  soakDaysCompleted: number;
  status: "not_started" | "in_progress" | "complete";
};

export function emptyAggregateReport(
  strategyVersion: string,
): V1SoakAggregateReport {
  return {
    paperOnly: true,
    disclaimer: "Paper results do not prove future profitability.",
    totalTradingDays: 0,
    daysWithNoQualifiedTrade: 0,
    totalEntryAttempts: 0,
    totalFilledEntries: 0,
    totalCompletedRoundTrips: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    winRate: null,
    grossPnl: null,
    netPnl: null,
    averageWin: null,
    averageLoss: null,
    profitFactor: null,
    maximumDailyLoss: null,
    maximumDrawdown: null,
    stopLossExits: 0,
    takeProfitExits: 0,
    maxHoldExits: 0,
    eodExits: 0,
    rejectedEntries: 0,
    partialFills: 0,
    reconciliationEvents: 0,
    missingProtectionIncidents: 0,
    duplicateOrderIncidents: 0,
    unresolvedPositionIncidents: 0,
    dailyTargetReachedCount: 0,
    dailyTargetMissedCount: 0,
    targetMissReasons: [],
    strategyVersion,
    configurationChanges: [],
    dataLimitations: [
      "Stage B soak has not started — aggregate awaits Stage A pass + multi-day evidence.",
    ],
    finalSafetyVerdict: "pending_stage_a",
    operationalReadinessVerdict: "not_ready",
    stageACompleted: false,
    soakDaysCompleted: 0,
    status: "not_started",
  };
}

export async function ensureAggregateScaffold(
  strategyVersion: string,
): Promise<string> {
  const dir = v1SoakDir();
  await mkdir(dir, { recursive: true });
  await mkdir(v1SoakDailyDir(), { recursive: true });
  const file = path.join(dir, "aggregate.json");
  try {
    await readFile(file, "utf8");
    return file;
  } catch {
    const report = emptyAggregateReport(strategyVersion);
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return file;
  }
}
