/**
 * Runtime kill switch / panic stop for auto paper trading.
 * Persists to data/auto-trade-runtime.json (no secrets).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutoTradeRuntimeState } from "@/lib/auto-trade/types";
import { marketDayKey } from "@/lib/market/time";

const DIR = path.join(process.cwd(), "data");
const FILE = path.join(DIR, "auto-trade-runtime.json");

const globalKey = "__tradingai_auto_trade_runtime__";

function defaultState(): AutoTradeRuntimeState {
  return {
    killSwitch: false,
    panicStop: false,
    runtimeDisabled: false,
    killSwitchAt: null,
    panicStopAt: null,
    lastAutoTradeAt: null,
    lastAutoTradeSymbol: null,
    dailyEstimatedPnL: 0,
    dailyPnLDate: marketDayKey(),
  };
}

function getMemoryCache(): AutoTradeRuntimeState {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: AutoTradeRuntimeState;
  };
  if (!g[globalKey]) {
    g[globalKey] = defaultState();
  }
  return g[globalKey]!;
}

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

async function readPersisted(): Promise<AutoTradeRuntimeState | null> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as AutoTradeRuntimeState;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // missing file
  }
  return null;
}

async function persist(state: AutoTradeRuntimeState): Promise<void> {
  await ensureDir();
  await writeFile(FILE, JSON.stringify(state, null, 2), "utf8");
  const g = globalThis as typeof globalThis & {
    [globalKey]?: AutoTradeRuntimeState;
  };
  g[globalKey] = state;
}

function rollDailyPnL(state: AutoTradeRuntimeState): AutoTradeRuntimeState {
  const today = marketDayKey();
  if (state.dailyPnLDate === today) return state;
  return {
    ...state,
    dailyPnLDate: today,
    dailyEstimatedPnL: 0,
  };
}

export async function getAutoTradeRuntime(): Promise<AutoTradeRuntimeState> {
  const cached = getMemoryCache();
  const persisted = await readPersisted();
  const merged = rollDailyPnL(persisted ?? cached);
  const g = globalThis as typeof globalThis & {
    [globalKey]?: AutoTradeRuntimeState;
  };
  g[globalKey] = merged;
  return merged;
}

export async function isAutoTradeRuntimeBlocked(): Promise<boolean> {
  const state = await getAutoTradeRuntime();
  return state.killSwitch || state.panicStop || state.runtimeDisabled;
}

/** Pause scanning only — does not set kill switch (distinct from Emergency Stop). */
export async function pauseEngine(): Promise<AutoTradeRuntimeState> {
  const state = rollDailyPnL(await getAutoTradeRuntime());
  const next: AutoTradeRuntimeState = {
    ...state,
    runtimeDisabled: true,
  };
  await persist(next);
  const { markPaperSessionStopped } = await import(
    "@/lib/trading/paper-session"
  );
  void markPaperSessionStopped();
  return next;
}

export async function activateKillSwitch(): Promise<AutoTradeRuntimeState> {
  const state = rollDailyPnL(await getAutoTradeRuntime());
  const next: AutoTradeRuntimeState = {
    ...state,
    killSwitch: true,
    runtimeDisabled: true,
    killSwitchAt: new Date().toISOString(),
  };
  await persist(next);
  const { markPaperSessionStopped } = await import(
    "@/lib/trading/paper-session"
  );
  void markPaperSessionStopped();
  return next;
}

export async function activatePanicStop(): Promise<AutoTradeRuntimeState> {
  const state = rollDailyPnL(await getAutoTradeRuntime());
  const next: AutoTradeRuntimeState = {
    ...state,
    panicStop: true,
    killSwitch: true,
    runtimeDisabled: true,
    panicStopAt: new Date().toISOString(),
    killSwitchAt: state.killSwitchAt ?? new Date().toISOString(),
  };
  await persist(next);
  return next;
}

export async function clearKillSwitch(): Promise<AutoTradeRuntimeState> {
  const state = rollDailyPnL(await getAutoTradeRuntime());
  const next: AutoTradeRuntimeState = {
    ...state,
    killSwitch: false,
    // Keep engine paused — user must Resume Engine explicitly.
    // Do not enable execution/auto (those are runtime settings).
    runtimeDisabled: true,
    killSwitchAt: null,
  };
  await persist(next);
  return next;
}

/**
 * Clear kill switch only — engine stays paused; trading flags unchanged.
 * Does not enable execution or auto trading.
 */
export async function clearKillSwitchKeepPaused(): Promise<AutoTradeRuntimeState> {
  return clearKillSwitch();
}

/** Clear panic / emergency stop deliberately. Engine stays paused. */
export async function clearPanicStop(): Promise<AutoTradeRuntimeState> {
  const state = rollDailyPnL(await getAutoTradeRuntime());
  const next: AutoTradeRuntimeState = {
    ...state,
    panicStop: false,
    killSwitch: false,
    // Stay paused until Resume Engine; do not re-enable trading.
    runtimeDisabled: true,
    panicStopAt: null,
    killSwitchAt: null,
  };
  await persist(next);
  return next;
}

/** Resume engine scanning after pause/kill (blocked while panic stop is on). */
export async function resumeAutoTrading(): Promise<{
  state: AutoTradeRuntimeState;
  resumed: boolean;
  reason?: string;
}> {
  const state = rollDailyPnL(await getAutoTradeRuntime());
  if (state.panicStop) {
    return {
      state,
      resumed: false,
      reason:
        "Emergency stop is active. Clear emergency stop first, then Resume Engine. Execution and Auto Trading stay OFF until you enable them.",
    };
  }
  const next: AutoTradeRuntimeState = {
    ...state,
    killSwitch: false,
    runtimeDisabled: false,
    killSwitchAt: null,
  };
  await persist(next);
  const { markPaperSessionStarted } = await import(
    "@/lib/trading/paper-session"
  );
  void markPaperSessionStarted();
  return {
    state: next,
    resumed: true,
    reason:
      "Engine resumed (scanning allowed). Execution and Auto Trading were not changed — enable them separately if needed.",
  };
}

export async function recordAutoTradeActivity(input: {
  symbol: string;
  estimatedPnL?: number | null;
}): Promise<AutoTradeRuntimeState> {
  const state = rollDailyPnL(await getAutoTradeRuntime());
  const pnlDelta = input.estimatedPnL ?? 0;
  const next: AutoTradeRuntimeState = {
    ...state,
    lastAutoTradeAt: new Date().toISOString(),
    lastAutoTradeSymbol: input.symbol.toUpperCase(),
    dailyEstimatedPnL: Number((state.dailyEstimatedPnL + pnlDelta).toFixed(4)),
  };
  await persist(next);
  return next;
}

/** Test helper */
export async function resetAutoTradeRuntimeForTests(): Promise<void> {
  const fresh = defaultState();
  await persist(fresh);
}
