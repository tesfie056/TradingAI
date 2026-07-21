/**
 * Shared runtime-status interpretation for Overview activity,
 * header lights, and status panel. Presentation only.
 */

import type { SystemStatusTone } from "@/lib/client/system-status-label";

export type RuntimeActivityKind =
  | "critical_failure"
  | "safety_block"
  | "scan_active"
  | "scan_failed"
  | "waiting_next_scan"
  | "market_closed"
  | "market_status_unavailable"
  | "auto_off"
  | "execution_off"
  | "engine_paused"
  | "ready";

export type RuntimeActivityView = {
  kind: RuntimeActivityKind;
  tone: SystemStatusTone;
  title: string;
  detail: string;
  stageLabel: string | null;
  currentSymbol: string | null;
  stocksChecked: number | null;
  stocksTotal: number | null;
  lastScanAt: string | null;
  nextScanAt: string | null;
  lastUpdateAt: string | null;
  showProgress: boolean;
  serverSideNote: boolean;
  actions: Array<"run_scan" | "manage_auto" | "retry" | "open_monitor" | "review_safety">;
};

export type RuntimeStatusInput = {
  autoTradingEnabled: boolean;
  orderExecutionEnabled: boolean;
  marketOpen: boolean | null;
  monitorRunning: boolean;
  monitorScanning: boolean;
  monitorConnected?: boolean | null;
  lastScanAt?: string | null;
  nextScanAt?: string | null;
  stocksScanned?: number | null;
  scannedSymbolsCount?: number | null;
  watchlistSize?: number | null;
  lastError?: string | null;
  heartbeatAt?: string | null;
  engineState?: string | null;
  runtimeDisabled?: boolean | null;
  safetyOk?: boolean;
  safetyLabel?: string | null;
  /** Latest symbol from recent symbol_scanned log, if any. */
  lastEvaluatedSymbol?: string | null;
  nowMs?: number;
};

const HEARTBEAT_STALE_MS = 90_000;
const SCAN_STALE_MS = 5 * 60_000;

/** Pause / normal skip notes must not light the engine red. */
export function isBenignMonitorNote(error: string | null | undefined): boolean {
  if (!error?.trim()) return false;
  const e = error.toLowerCase();
  return (
    e.includes("engine paused") ||
    e.includes("scanning suspended") ||
    e.includes("no new scans") ||
    e.includes("new entries are paused") ||
    e.includes("resume engine") ||
    e.includes("no eligible") ||
    e.includes("market is closed") ||
    e.includes("market closed") ||
    e.includes("opening delay") ||
    e.includes("eod") ||
    e.includes("daily limit") ||
    e.includes("execution is disabled") ||
    e.includes("auto trading is disabled") ||
    e.includes("zero eligible")
  );
}

/** Explicit pause messages written into monitor lastError. */
export function isEnginePauseNote(error: string | null | undefined): boolean {
  if (!error?.trim()) return false;
  const e = error.toLowerCase();
  return (
    e.includes("engine paused") ||
    e.includes("scanning suspended") ||
    e.includes("no new scans or proposals") ||
    e.includes("new entries are paused") ||
    e.includes("resume engine")
  );
}

export function isRealScanFailure(error: string | null | undefined): boolean {
  if (!error?.trim()) return false;
  if (isBenignMonitorNote(error)) return false;
  const e = error.toLowerCase();
  // Prefer clear failure language — avoid flagging benign "data" wording in skip notes.
  return (
    e.includes("exception") ||
    e.includes("unhandled") ||
    e.includes("failed") ||
    e.includes("unavailable") ||
    e.includes("timeout") ||
    e.includes("disconnect") ||
    e.includes("unauthorized") ||
    e.includes("rate limit") ||
    e.includes(" 500") ||
    e.includes(" 503") ||
    e.includes("broker error") ||
    e.includes("quote unavailable") ||
    e.includes("market data") ||
    e.includes("stale quote")
  );
}

/** Latest symbol_scanned log entry, if present. */
export function lastEvaluatedSymbolFromLogs(
  logs:
    | Array<{
        event?: string;
        message?: string;
        meta?: Record<string, string | number | boolean | null> | undefined;
      }>
    | null
    | undefined,
): string | null {
  if (!logs?.length) return null;
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i]!;
    if (log.event !== "symbol_scanned") continue;
    const fromMeta = log.meta?.symbol;
    if (typeof fromMeta === "string" && fromMeta.trim()) {
      return fromMeta.trim().toUpperCase();
    }
    const m = log.message?.match(/\b([A-Z]{1,5})\b/);
    if (m?.[1]) return m[1];
  }
  return null;
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return now - t;
}

export function formatCountdown(
  nextScanAt: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!nextScanAt) return null;
  const ms = Date.parse(nextScanAt) - nowMs;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "Starting soon";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export function plainOpportunitySummary(input: {
  symbol: string;
  action?: string | null;
  summary?: string | null;
  reasons?: string[] | null;
}): { headline: string; detail: string; technical: string | null } {
  const action = (input.action ?? "").toUpperCase();
  const raw =
    input.summary?.trim() ||
    input.reasons?.[0]?.trim() ||
    null;
  const technical = raw;

  if (action === "BUY") {
    return {
      headline: `${input.symbol} may be ready to trade`,
      detail: "Review the setup before placing a paper order.",
      technical,
    };
  }
  if (action === "SELL") {
    return {
      headline: `${input.symbol} has a sell signal`,
      detail: "Review the position before taking action.",
      technical,
    };
  }
  if (action === "SKIP" || action === "HOLD" || action === "WATCH") {
    return {
      headline: `${input.symbol} is not ready to trade`,
      detail: "Some entry requirements were not met.",
      technical,
    };
  }
  return {
    headline: `${input.symbol} needs review`,
    detail: "Open details to see why this stock is waiting.",
    technical,
  };
}

/**
 * Engine health separate from auto-intent / monitor loop.
 */
export function mapEngineHealth(input: RuntimeStatusInput): {
  tone: SystemStatusTone;
  state: string;
  detail: string;
  critical: boolean;
} {
  const now = input.nowMs ?? Date.now();
  const err = input.lastError?.trim() || null;
  const realFail = isRealScanFailure(err);
  const hbAge = ageMs(input.heartbeatAt, now);
  const staleHb = hbAge != null && hbAge > HEARTBEAT_STALE_MS;
  const paused =
    input.runtimeDisabled === true ||
    input.engineState === "PAUSED" ||
    input.engineState === "EMERGENCY_STOPPED" ||
    isEnginePauseNote(err);

  if (realFail && (input.monitorRunning || input.monitorScanning)) {
    return {
      tone: "bad",
      state: "Error",
      detail: err ?? "The scan loop reported an unrecovered failure.",
      critical: true,
    };
  }
  if (realFail && !input.monitorRunning) {
    return {
      tone: "bad",
      state: "Error",
      detail: err ?? "The last scan reported an unrecovered failure.",
      critical: true,
    };
  }
  // Browser stream drop is not an engine failure when the worker is still running.
  if (input.monitorConnected === false && !input.monitorRunning) {
    return {
      tone: "warn",
      state: "Unknown",
      detail: "Live status updates are reconnecting. Engine health is not confirmed yet.",
      critical: false,
    };
  }
  if (paused) {
    return {
      tone: "warn",
      state: "Waiting",
      detail: "The engine is paused or waiting. Resume from Auto Trading when ready.",
      critical: false,
    };
  }
  if (staleHb && input.monitorRunning) {
    return {
      tone: "warn",
      state: "Update delayed",
      detail: "Status updates are delayed. The process may still be running.",
      critical: false,
    };
  }
  if (input.monitorScanning || input.monitorRunning) {
    return {
      tone: "ok",
      state: "Healthy",
      detail: input.monitorScanning
        ? "A scan is in progress and the engine is responsive."
        : "No unrecovered engine errors.",
      critical: false,
    };
  }
  if (!input.autoTradingEnabled && !input.monitorRunning) {
    return {
      tone: "neutral",
      state: "Inactive",
      detail: "Automation is off and the monitor is stopped.",
      critical: false,
    };
  }
  return {
    tone: "neutral",
    state: "Unknown",
    detail: "Engine health has not been confirmed yet.",
    critical: false,
  };
}

export function mapScanStatus(input: RuntimeStatusInput): {
  tone: SystemStatusTone;
  state: string;
  detail: string;
  critical: boolean;
} {
  const now = input.nowMs ?? Date.now();
  const err = input.lastError?.trim() || null;
  const realFail = isRealScanFailure(err);
  const scanAgo = ageMs(input.lastScanAt, now);

  // Pause notes win over a stale scanning flag from SSE.
  if (isEnginePauseNote(err) || input.runtimeDisabled || input.engineState === "PAUSED") {
    return {
      tone: "warn",
      state: "Paused",
      detail: err?.trim() || "New entries are paused. Resume Engine to allow scans.",
      critical: false,
    };
  }
  if (input.monitorScanning) {
    return {
      tone: "ok",
      state: "Scanning",
      detail: input.lastEvaluatedSymbol
        ? `Evaluating ${input.lastEvaluatedSymbol} now.`
        : "Evaluating the watchlist now.",
      critical: false,
    };
  }
  if (realFail) {
    return {
      tone: "bad",
      state: "Failed",
      detail: err ?? "The last scan could not finish.",
      critical: true,
    };
  }
  if (!input.monitorRunning) {
    return {
      tone: "neutral",
      state: "Not scheduled",
      detail: "No scan is scheduled because the monitor is stopped.",
      critical: false,
    };
  }
  if (scanAgo != null && scanAgo > SCAN_STALE_MS && input.marketOpen !== false) {
    return {
      tone: "warn",
      state: "Delayed",
      detail: "The last completed scan is older than expected.",
      critical: false,
    };
  }
  if (input.lastScanAt) {
    return {
      tone: "warn",
      state: "Waiting",
      detail: input.nextScanAt
        ? `Last scan finished. Next scan around ${new Date(input.nextScanAt).toLocaleTimeString()}.`
        : "Waiting for the monitor’s next scan.",
      critical: false,
    };
  }
  return {
    tone: "warn",
    state: "Waiting",
    detail: "Waiting for the first scan to complete.",
    critical: false,
  };
}

export function buildRuntimeActivity(
  input: RuntimeStatusInput,
): RuntimeActivityView {
  const now = input.nowMs ?? Date.now();
  const stocksChecked =
    input.stocksScanned ?? input.scannedSymbolsCount ?? null;
  const stocksTotal = input.watchlistSize ?? stocksChecked;
  const engine = mapEngineHealth(input);
  const realFail = isRealScanFailure(input.lastError);
  const paused =
    input.runtimeDisabled === true ||
    input.engineState === "PAUSED" ||
    input.engineState === "EMERGENCY_STOPPED";

  const base = {
    stageLabel: null as string | null,
    currentSymbol: input.lastEvaluatedSymbol ?? null,
    stocksChecked,
    stocksTotal,
    lastScanAt: input.lastScanAt ?? null,
    nextScanAt: input.nextScanAt ?? null,
    lastUpdateAt: input.heartbeatAt ?? input.lastScanAt ?? null,
    showProgress: false,
    serverSideNote: true,
  };

  if (realFail && engine.critical) {
    return {
      ...base,
      kind: "critical_failure",
      tone: "bad",
      title: "Scan could not finish",
      detail: input.lastError?.trim() || engine.detail,
      actions: ["retry", "open_monitor"],
    };
  }

  if (input.safetyOk === false) {
    return {
      ...base,
      kind: "safety_block",
      tone: "warn",
      title: "Auto trading is waiting",
      detail: input.safetyLabel
        ? `A safety rule currently prevents new trades. ${input.safetyLabel}`
        : "A safety rule currently prevents new trades.",
      actions: ["review_safety", "manage_auto"],
    };
  }

  // Prefer pause over a stale scanning flag.
  if (paused) {
    return {
      ...base,
      kind: "engine_paused",
      tone: "warn",
      title: "Auto trading is paused",
      detail:
        input.lastError?.trim() ||
        "New scans and proposals are suspended until you resume the engine.",
      actions: ["manage_auto"],
    };
  }

  if (input.monitorScanning) {
    return {
      ...base,
      kind: "scan_active",
      tone: "ok",
      title: "Scanning stocks",
      detail: input.lastEvaluatedSymbol
        ? `Checking the watchlist. Current stock: ${input.lastEvaluatedSymbol}.`
        : "Evaluating the watchlist now.",
      stageLabel: input.lastEvaluatedSymbol
        ? `Evaluating ${input.lastEvaluatedSymbol}`
        : "Checking watchlist",
      showProgress: false,
      actions: ["open_monitor", "manage_auto"],
    };
  }

  if (realFail) {
    return {
      ...base,
      kind: "scan_failed",
      tone: "bad",
      title: "Scan could not finish",
      detail: input.lastError?.trim() || "The last scan failed.",
      actions: ["retry", "open_monitor"],
    };
  }

  if (input.marketOpen === null) {
    return {
      ...base,
      kind: "market_status_unavailable",
      tone: "warn",
      title: "Market status unavailable",
      detail:
        "Broker clock could not be confirmed. New paper orders stay blocked until market status is available.",
      actions: ["open_monitor", "manage_auto"],
      serverSideNote: true,
    };
  }

  if (input.marketOpen === false) {
    return {
      ...base,
      kind: "market_closed",
      tone: "warn",
      title: "Market is closed",
      detail: input.monitorRunning
        ? "The monitor keeps checking on a slower schedule. New entries wait for the regular session."
        : "New stock entries wait until the regular U.S. market opens.",
      actions: ["manage_auto"],
      serverSideNote: input.monitorRunning,
    };
  }

  if (!input.autoTradingEnabled) {
    return {
      ...base,
      kind: "auto_off",
      tone: "neutral",
      title: "Auto trading is off",
      detail: "Turn automation on from Auto Trading when you want paper orders submitted automatically.",
      actions: ["manage_auto"],
      serverSideNote: false,
    };
  }

  if (!input.orderExecutionEnabled) {
    return {
      ...base,
      kind: "execution_off",
      tone: "warn",
      title: "Paper execution is off",
      detail: "Automation may scan, but paper order submission stays locked until execution is enabled.",
      actions: ["manage_auto"],
    };
  }

  if (input.monitorRunning) {
    const countdown = formatCountdown(input.nextScanAt, now);
    return {
      ...base,
      kind: "waiting_next_scan",
      tone: "ok",
      title: "Auto trading is active",
      detail: countdown
        ? `Waiting for the next scan. Next scan in ${countdown}.`
        : "Waiting for the monitor’s next scan.",
      stageLabel: "Idle between scans",
      actions: ["run_scan", "manage_auto"],
    };
  }

  return {
    ...base,
    kind: "ready",
    tone: "warn",
    title: "Monitor is stopped",
    detail: "Start monitoring from Advanced Monitoring so scans can run automatically.",
    actions: ["open_monitor", "manage_auto"],
    serverSideNote: false,
  };
}

/** Overview primary banner priority (does not use open-position as primary). */
export function resolveOverviewPrimaryBanner(
  activity: RuntimeActivityView,
): { message: string; detail: string; tone: SystemStatusTone } {
  return {
    message: activity.title,
    detail: activity.detail,
    tone: activity.tone,
  };
}
