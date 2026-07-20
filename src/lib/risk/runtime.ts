/**
 * Risk runtime state — consecutive wins/losses, daily P&L pause.
 * Persisted under data/risk-runtime.json. Paper only.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { marketDayKey } from "@/lib/market/time";
import { getTradingDataDir } from "@/lib/paths/data-root";

function riskRuntimeFile(): string {
  return path.join(getTradingDataDir(), "risk-runtime.json");
}

export type RiskRuntimeState = {
  paperOnly: true;
  dayKey: string;
  consecutiveLosses: number;
  consecutiveWins: number;
  dailyRealizedPnL: number;
  dailyUnrealizedPnL: number;
  entriesPaused: boolean;
  pauseReason: string | null;
  lastReconciledAt: string | null;
  reconciliationComplete: boolean;
};

function defaultState(dayKey = marketDayKey()): RiskRuntimeState {
  return {
    paperOnly: true,
    dayKey,
    consecutiveLosses: 0,
    consecutiveWins: 0,
    dailyRealizedPnL: 0,
    dailyUnrealizedPnL: 0,
    entriesPaused: false,
    pauseReason: null,
    lastReconciledAt: null,
    reconciliationComplete: false,
  };
}

async function ensureDir() {
  await mkdir(getTradingDataDir(), { recursive: true });
}

export async function readRiskRuntime(): Promise<RiskRuntimeState> {
  const today = marketDayKey();
  try {
    const raw = await readFile(riskRuntimeFile(), "utf8");
    const parsed = JSON.parse(raw) as RiskRuntimeState;
    if (parsed?.paperOnly !== true) return defaultState(today);
    if (parsed.dayKey !== today) {
      return {
        ...defaultState(today),
        lastReconciledAt: parsed.lastReconciledAt,
        reconciliationComplete: false,
      };
    }
    return parsed;
  } catch {
    return defaultState(today);
  }
}

export async function writeRiskRuntime(
  state: RiskRuntimeState,
): Promise<RiskRuntimeState> {
  await ensureDir();
  const next = { ...state, paperOnly: true as const };
  await writeFile(
    riskRuntimeFile(),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
  return next;
}

export async function updateRiskRuntime(
  patch: Partial<RiskRuntimeState>,
): Promise<RiskRuntimeState> {
  const current = await readRiskRuntime();
  return writeRiskRuntime({ ...current, ...patch });
}

export async function recordTradeOutcome(input: {
  pnl: number;
}): Promise<RiskRuntimeState> {
  const current = await readRiskRuntime();
  const win = input.pnl > 0;
  const loss = input.pnl < 0;
  return writeRiskRuntime({
    ...current,
    dailyRealizedPnL: current.dailyRealizedPnL + input.pnl,
    consecutiveWins: win ? current.consecutiveWins + 1 : 0,
    consecutiveLosses: loss ? current.consecutiveLosses + 1 : 0,
  });
}

/** Test helper */
export async function resetRiskRuntimeForTests(): Promise<void> {
  await writeRiskRuntime(defaultState());
}
