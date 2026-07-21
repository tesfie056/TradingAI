/**
 * Unified engine-state derivation — single source for UI badges.
 */

import type {
  AutoTradeEngineState,
  EngineControlSnapshot,
} from "@/lib/auto-trade/runtime-settings/types";

export function deriveEngineControlSnapshot(input: {
  executionEnabled: boolean;
  autoTradingEnabled: boolean;
  killSwitch: boolean;
  panicStop: boolean;
  runtimeDisabled: boolean;
  marketOpen: boolean | null;
  dailyTradesUsed: number;
  maxDailyTrades: number;
  monitorRunning: boolean;
  monitorScanning: boolean;
}): EngineControlSnapshot {
  const {
    executionEnabled,
    autoTradingEnabled,
    killSwitch,
    panicStop,
    runtimeDisabled,
    marketOpen,
    dailyTradesUsed,
    maxDailyTrades,
    monitorRunning,
    monitorScanning,
  } = input;

  const dailyLimitReached = dailyTradesUsed >= maxDailyTrades;
  const blockingReasons: string[] = [];

  if (panicStop) blockingReasons.push("Emergency stop is active");
  if (killSwitch) blockingReasons.push("Kill switch is active");
  if (runtimeDisabled && !killSwitch && !panicStop) {
    blockingReasons.push(
      "New entries are paused. Resume Engine from Auto Trading to allow scans and proposals.",
    );
  }
  if (!executionEnabled) blockingReasons.push("Paper execution is OFF");
  if (!autoTradingEnabled) blockingReasons.push("Auto trading is OFF");
  if (dailyLimitReached) {
    blockingReasons.push(
      `Daily trade limit reached (${dailyTradesUsed}/${maxDailyTrades})`,
    );
  }
  if (marketOpen === false) blockingReasons.push("Market is closed");
  if (marketOpen === null) {
    blockingReasons.push("Market status unavailable");
  }

  const canScan =
    !panicStop && !killSwitch && !runtimeDisabled && monitorRunning;
  const effectivelyAutoTrading =
    executionEnabled &&
    autoTradingEnabled &&
    !killSwitch &&
    !panicStop &&
    !runtimeDisabled;
  const canSubmitOrders =
    executionEnabled && !panicStop && !killSwitch && !runtimeDisabled;

  let engineState: AutoTradeEngineState;
  if (panicStop) {
    engineState = "EMERGENCY_STOPPED";
  } else if (killSwitch || runtimeDisabled) {
    engineState = "PAUSED";
  } else if (!monitorRunning && !autoTradingEnabled) {
    engineState = "STOPPED";
  } else if (dailyLimitReached && effectivelyAutoTrading) {
    engineState = "DAILY_LIMIT_REACHED";
  } else if (marketOpen === false && effectivelyAutoTrading) {
    engineState = "MARKET_CLOSED";
  } else if (effectivelyAutoTrading) {
    engineState = monitorScanning ? "AUTO_TRADING" : "AUTO_TRADING";
  } else if (canScan || monitorRunning) {
    engineState = "SCANNING_ONLY";
  } else {
    engineState = "STOPPED";
  }

  return {
    engineState,
    executionEnabled,
    autoTradingEnabled,
    killSwitchActive: killSwitch,
    panicStopActive: panicStop,
    canScan,
    canSubmitOrders: canSubmitOrders && !panicStop,
    blockingReasons,
    effectivelyAutoTrading,
  };
}

export function engineStateLabel(state: AutoTradeEngineState): string {
  switch (state) {
    case "STOPPED":
      return "Stopped";
    case "PAUSED":
      return "Paused";
    case "SCANNING_ONLY":
      return "Scanning only";
    case "AUTO_TRADING":
      return "Auto trading";
    case "EMERGENCY_STOPPED":
      return "Emergency stopped";
    case "DAILY_LIMIT_REACHED":
      return "Daily limit reached";
    case "MARKET_CLOSED":
      return "Market closed";
    default:
      return state;
  }
}
