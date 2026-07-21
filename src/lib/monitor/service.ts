/**
 * In-process monitor agent + background worker scheduling.
 * Scans run on a timer independent of page visits when worker auto-start is on.
 */

import { checkOllamaHealth, getAiProviderName } from "@/lib/ai/provider";
import { getWatchlist } from "@/lib/config";
import { getFreshBrokerClock } from "@/lib/market/broker-clock";
import {
  describeEnginePauseReason,
  isEnginePaused,
} from "@/lib/auto-trade/pause-reason";
import { publishMonitorStream } from "@/lib/monitor/broadcast";
import { appendMonitorLog, readMonitorLogs } from "@/lib/monitor/logs";
import {
  pickTopOpportunity,
  readActiveOpportunities,
} from "@/lib/monitor/queue";
import {
  formatTopSignalLabel,
  readLastScanSnapshot,
} from "@/lib/monitor/scan-snapshot";
import {
  summarizeLastScan,
  type MonitorScanSummary,
} from "@/lib/monitor/scan-summary";
import {
  getMonitorHeartbeatMs,
  getMonitorIntervalClosedMs,
  getMonitorIntervalOpenMs,
  getMonitorIntervalMs,
} from "@/lib/monitor/rate-limit";
import { runMonitorScan, type MonitorScanResult } from "@/lib/monitor/scanner";
import { assertMonitorPaperOnly, monitorSafetyFlags } from "@/lib/monitor/safety";
import type {
  MonitorNotification,
  MonitorStatus,
} from "@/lib/monitor/types";

/** Warn UI when a scan flag stays true longer than a full watchlist pass should. */
const SCAN_STALL_WARN_MS = 5 * 60_000;

export type MonitorServiceState = {
  running: boolean;
  scanning: boolean;
  intervalMs: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  scheduleTimer: ReturnType<typeof setTimeout> | null;
  lastScanAt: string | null;
  lastSuccessfulScanAt: string | null;
  lastSkipAt: string | null;
  nextScanAt: string | null;
  scanStartedAt: string | null;
  stocksScanned: number;
  opportunitiesFound: number;
  lastError: string | null;
  pauseReason: string | null;
  scanOutcome: MonitorStatus["scanOutcome"];
  ollamaAvailable: boolean | null;
  notifications: MonitorNotification[];
  lastResult: MonitorScanResult | null;
  marketOpen: boolean | null;
  workerMode: boolean;
};

const globalKey = "__tradingai_monitor_service__";

export function getMonitorServiceState(): MonitorServiceState {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: MonitorServiceState;
  };
  if (!g[globalKey]) {
    g[globalKey] = {
      running: false,
      scanning: false,
      intervalMs: getMonitorIntervalMs(),
      heartbeatTimer: null,
      scheduleTimer: null,
      lastScanAt: null,
      lastSuccessfulScanAt: null,
      lastSkipAt: null,
      nextScanAt: null,
      scanStartedAt: null,
      stocksScanned: 0,
      opportunitiesFound: 0,
      lastError: null,
      pauseReason: null,
      scanOutcome: "idle",
      ollamaAvailable: null,
      notifications: [],
      lastResult: null,
      marketOpen: null,
      workerMode: false,
    };
  }
  return g[globalKey]!;
}

async function refreshOllamaFlag(state: MonitorServiceState): Promise<void> {
  if (getAiProviderName() !== "ollama") {
    state.ollamaAvailable = false;
    return;
  }
  try {
    const health = await checkOllamaHealth();
    state.ollamaAvailable = Boolean(health.connected);
  } catch {
    state.ollamaAvailable = false;
  }
}

async function resolveScanIntervalMs(state: MonitorServiceState): Promise<number> {
  const clock = await getFreshBrokerClock();
  state.marketOpen = clock.isOpen;
  // Unavailable → use closed-interval cadence (slower), but do not mark closed.
  return clock.isOpen === true
    ? getMonitorIntervalOpenMs()
    : getMonitorIntervalClosedMs();
}

function clearTimers(state: MonitorServiceState): void {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  if (state.scheduleTimer) clearTimeout(state.scheduleTimer);
  state.heartbeatTimer = null;
  state.scheduleTimer = null;
}

function emitHeartbeat(state: MonitorServiceState): void {
  publishMonitorStream({
    type: "heartbeat",
    at: new Date().toISOString(),
    workerRunning: state.running,
    scanning: state.scanning,
    marketOpen: state.marketOpen,
  });
}

async function emitStatus(kind: "status" | "scan_completed"): Promise<void> {
  const status = await buildMonitorStatus();
  publishMonitorStream({ type: kind, at: new Date().toISOString(), status });
}

function startHeartbeatLoop(state: MonitorServiceState): void {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  const ms = getMonitorHeartbeatMs();
  state.heartbeatTimer = setInterval(() => {
    emitHeartbeat(state);
  }, ms);
  if (typeof state.heartbeatTimer === "object" && "unref" in state.heartbeatTimer) {
    state.heartbeatTimer.unref?.();
  }
}

async function scheduleNextScan(state: MonitorServiceState): Promise<void> {
  if (!state.running) return;
  if (state.scheduleTimer) clearTimeout(state.scheduleTimer);
  state.intervalMs = await resolveScanIntervalMs(state);
  state.nextScanAt = new Date(Date.now() + state.intervalMs).toISOString();
  state.scheduleTimer = setTimeout(() => {
    void (async () => {
      await executeMonitorScan(false);
      await scheduleNextScan(state);
    })();
  }, state.intervalMs);
  if (typeof state.scheduleTimer === "object" && "unref" in state.scheduleTimer) {
    state.scheduleTimer.unref?.();
  }
}

function applyScanResult(
  state: MonitorServiceState,
  result: MonitorScanResult,
): void {
  state.lastResult = result;
  // Never let pause/skip stubs force "closed" over a real Alpaca clock.
  if (result.marketOpen != null) {
    state.marketOpen = result.marketOpen;
  }

  if (result.outcome === "paused" || (result.skipped && result.pauseReason)) {
    state.scanOutcome = "paused";
    state.pauseReason = result.pauseReason ?? result.error ?? null;
    state.lastError = state.pauseReason;
    state.lastSkipAt = result.scannedAt;
    // Preserve prior stocksScanned / last successful scan timestamps.
    return;
  }

  if (result.rateLimited || result.outcome === "rate_limited") {
    state.scanOutcome = "idle";
    state.lastError = result.error ?? null;
    state.lastSkipAt = result.scannedAt;
    return;
  }

  if (result.outcome === "failed") {
    state.scanOutcome = "failed";
    state.lastError = result.error ?? "Scan failed";
    state.pauseReason = null;
    return;
  }

  // completed or empty_universe — real evaluation pass
  state.scanOutcome = "completed";
  state.lastScanAt = result.scannedAt;
  state.lastSuccessfulScanAt = result.scannedAt;
  state.pauseReason = null;
  if (result.stocksScanned > 0 || result.symbols.length > 0) {
    state.stocksScanned = Math.max(
      result.stocksScanned,
      result.symbols.length,
    );
  }
  state.opportunitiesFound = result.opportunitiesFound;
  // empty_universe carries a reason but is not an engine failure
  state.lastError =
    result.outcome === "empty_universe" ? (result.error ?? null) : null;
}

async function buildPausedSkipResult(): Promise<MonitorScanResult> {
  const { getAutoTradeRuntime } = await import("@/lib/auto-trade/runtime");
  const runtime = await getAutoTradeRuntime();
  const pauseReason = describeEnginePauseReason(runtime);
  const watchlistSize = getWatchlist().length;
  const opportunities = await readActiveOpportunities();
  return {
    paperOnly: true,
    canPlaceOrders: false,
    scannedAt: new Date().toISOString(),
    stocksScanned: 0,
    symbols: [],
    watchlistSize,
    opportunities,
    opportunitiesFound: 0,
    topOpportunity: pickTopOpportunity(opportunities),
    topSignalLabel: "Scanning suspended — engine paused",
    lastScan: null,
    notifications: [],
    marketOpen: null,
    ollamaUsed: false,
    ollamaFallback: false,
    aiProvider: "skipped",
    skipped: true,
    outcome: "paused",
    pauseReason,
    error: pauseReason,
  };
}

export async function executeMonitorScan(force = false): Promise<MonitorScanResult> {
  const state = getMonitorServiceState();
  if (state.scanning) {
    return (
      state.lastResult ?? {
        paperOnly: true,
        canPlaceOrders: false,
        scannedAt: new Date().toISOString(),
        symbols: [],
        stocksScanned: 0,
        opportunities: [],
        opportunitiesFound: 0,
        topOpportunity: null,
        topSignalLabel: "Scan already in progress",
        lastScan: null,
        notifications: [],
        marketOpen: null,
        ollamaUsed: false,
        ollamaFallback: false,
        aiProvider: "busy",
        error: "Scan already in progress",
        outcome: "failed",
      }
    );
  }

  assertMonitorPaperOnly();

  // Pause check BEFORE scanning=true — avoids contradictory "Scanning" + paused UI.
  try {
    const { getAutoTradeRuntime } = await import("@/lib/auto-trade/runtime");
    const runtime = await getAutoTradeRuntime();
    if (isEnginePaused(runtime)) {
      await appendMonitorLog({
        event: "scan_completed",
        level: "warn",
        message: `Scan skipped — ${describeEnginePauseReason(runtime)}`,
        meta: {
          skipped: true,
          outcome: "paused",
          watchlistSize: getWatchlist().length,
        },
      });
      const result = await buildPausedSkipResult();
      applyScanResult(state, result);
      if (result.notifications.length > 0) {
        state.notifications = [
          ...result.notifications,
          ...state.notifications,
        ].slice(0, 20);
      }
      await emitStatus("status");
      return result;
    }
  } catch {
    // If runtime cannot be read, continue into a normal scan attempt.
  }

  state.scanning = true;
  state.scanStartedAt = new Date().toISOString();
  state.scanOutcome = "scanning";
  state.pauseReason = null;
  emitHeartbeat(state);
  try {
    await refreshOllamaFlag(state);
    const result = await runMonitorScan({ force });
    applyScanResult(state, result);
    if (result.notifications.length > 0) {
      state.notifications = [
        ...result.notifications,
        ...state.notifications,
      ].slice(0, 20);
    }
    await emitStatus("scan_completed");
    return result;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Monitor scan failed";
    const failed: MonitorScanResult = {
      paperOnly: true,
      canPlaceOrders: false,
      scannedAt: new Date().toISOString(),
      symbols: getWatchlist(),
      stocksScanned: 0,
      watchlistSize: getWatchlist().length,
      opportunities: [],
      opportunitiesFound: 0,
      topOpportunity: null,
      topSignalLabel: "Scan failed",
      lastScan: null,
      notifications: [],
      marketOpen: null,
      ollamaUsed: false,
      ollamaFallback: false,
      aiProvider: "error",
      outcome: "failed",
      error: message,
    };
    applyScanResult(state, failed);
    await appendMonitorLog({
      event: "scan_error",
      level: "error",
      message,
    });
    await emitStatus("scan_completed");
    return failed;
  } finally {
    state.scanning = false;
    state.scanStartedAt = null;
    if (state.scanOutcome === "scanning") {
      state.scanOutcome = state.lastError ? "failed" : "idle";
    }
    emitHeartbeat(state);
  }
}

function scanStalled(state: MonitorServiceState): boolean {
  if (!state.scanning || !state.scanStartedAt) return false;
  const age = Date.now() - Date.parse(state.scanStartedAt);
  return Number.isFinite(age) && age > SCAN_STALL_WARN_MS;
}

async function buildMonitorStatus(): Promise<MonitorStatus> {
  const state = getMonitorServiceState();
  const active = await readActiveOpportunities();
  const logs = await readMonitorLogs(12);
  const lastScan =
    state.lastResult?.lastScan ?? (await readLastScanSnapshot());
  const top =
    pickTopOpportunity(active) ?? state.lastResult?.topOpportunity ?? null;
  const watchlistSize = getWatchlist().length;
  const stalled = scanStalled(state);

  // Refresh Alpaca clock so pause/skip scans cannot leave a stale "closed".
  const brokerClock = await getFreshBrokerClock();
  state.marketOpen = brokerClock.isOpen;

  let enginePaused = false;
  let pauseReason = state.pauseReason;
  try {
    const { getAutoTradeRuntime } = await import("@/lib/auto-trade/runtime");
    const runtime = await getAutoTradeRuntime();
    enginePaused = isEnginePaused(runtime);
    if (enginePaused) {
      pauseReason = describeEnginePauseReason(runtime);
    }
  } catch {
    // ignore
  }

  let agentStatus: MonitorStatus["status"] = "stopped";
  if (state.scanning && !enginePaused) agentStatus = "scanning";
  else if (state.running) agentStatus = "running";

  let scanOutcome: MonitorStatus["scanOutcome"] = state.scanOutcome ?? "idle";
  if (state.scanning && !enginePaused) scanOutcome = stalled ? "stalled" : "scanning";
  else if (enginePaused) scanOutcome = "paused";
  else if (state.running && scanOutcome === "idle") scanOutcome = "scheduled";

  const stocksScanned =
    state.stocksScanned > 0
      ? state.stocksScanned
      : (lastScan?.stocksScanned ?? 0);

  const topSignalLabel = enginePaused
    ? "Scanning suspended — engine paused"
    : (state.lastResult?.topSignalLabel ??
      formatTopSignalLabel(lastScan) ??
      (top
        ? `Top signal from ${stocksScanned || "?"} scanned symbols: ${top.symbol} · ${top.action}`
        : "No scan yet"));

  const scanSummary: MonitorScanSummary | null = summarizeLastScan(lastScan);

  return {
    ...monitorSafetyFlags(),
    status: agentStatus,
    running: state.running,
    scanning: state.scanning && !enginePaused,
    intervalMs: state.intervalMs,
    lastScanAt: state.lastSuccessfulScanAt ?? state.lastScanAt,
    nextScanAt: state.running && !enginePaused ? state.nextScanAt : null,
    stocksScanned,
    scannedSymbols:
      lastScan?.symbols ??
      (state.lastResult?.outcome === "completed"
        ? state.lastResult.symbols
        : []),
    opportunitiesFound: state.opportunitiesFound,
    activeOpportunities: active.length,
    topOpportunity: top,
    topSignalLabel,
    lastError: enginePaused
      ? (pauseReason ?? state.lastError)
      : state.lastError,
    ollamaAvailable: state.ollamaAvailable,
    notifications: state.notifications.slice(0, 8),
    recentLogs: logs,
    workerMode: state.workerMode,
    marketOpen: state.marketOpen,
    marketSessionStatus: brokerClock.status,
    clockError: brokerClock.error,
    clockFetchedAt: brokerClock.fetchedAt,
    heartbeatAt: new Date().toISOString(),
    intervalOpenMs: getMonitorIntervalOpenMs(),
    intervalClosedMs: getMonitorIntervalClosedMs(),
    enginePaused,
    pauseReason: pauseReason ?? null,
    scanOutcome,
    watchlistSize,
    lastSuccessfulScanAt: state.lastSuccessfulScanAt,
    lastSkipAt: state.lastSkipAt,
    scanStartedAt: state.scanning ? state.scanStartedAt : null,
    scanStalled: stalled,
    scanSummary,
  };
}

export async function startMonitor(options?: {
  worker?: boolean;
}): Promise<MonitorStatus> {
  assertMonitorPaperOnly();
  const state = getMonitorServiceState();
  state.workerMode = options?.worker ?? false;

  if (state.running) {
    return buildMonitorStatus();
  }

  state.running = true;
  state.intervalMs = await resolveScanIntervalMs(state);
  state.nextScanAt = new Date(Date.now() + 1_000).toISOString();

  await appendMonitorLog({
    event: "monitor_started",
    message: state.workerMode
      ? `Background worker started (open ${Math.round(getMonitorIntervalOpenMs() / 1000)}s / closed ${Math.round(getMonitorIntervalClosedMs() / 60000)} min)`
      : `Monitoring agent started (open ${Math.round(getMonitorIntervalOpenMs() / 1000)}s / closed ${Math.round(getMonitorIntervalClosedMs() / 60000)} min)`,
    meta: { intervalMs: state.intervalMs, worker: state.workerMode },
  });

  const { markPaperSessionStarted } = await import(
    "@/lib/trading/paper-session"
  );
  void markPaperSessionStarted();

  startHeartbeatLoop(state);
  void executeMonitorScan(true).then(() => scheduleNextScan(state));

  return buildMonitorStatus();
}

export async function stopMonitor(): Promise<MonitorStatus> {
  const state = getMonitorServiceState();
  clearTimers(state);
  state.running = false;
  state.workerMode = false;
  state.nextScanAt = null;
  state.scanOutcome = "idle";
  await appendMonitorLog({
    event: "monitor_stopped",
    message: "Monitoring agent stopped",
  });
  const { markPaperSessionStopped } = await import(
    "@/lib/trading/paper-session"
  );
  void markPaperSessionStopped();
  await emitStatus("status");
  return buildMonitorStatus();
}

export async function scanMonitorNow(): Promise<{
  status: MonitorStatus;
  scan: MonitorScanResult;
}> {
  const scan = await executeMonitorScan(true);
  return { status: await buildMonitorStatus(), scan };
}

export async function getMonitorStatus(): Promise<MonitorStatus> {
  return buildMonitorStatus();
}

/** Test helper */
export function resetMonitorServiceForTests(): void {
  const state = getMonitorServiceState();
  clearTimers(state);
  state.running = false;
  state.scanning = false;
  state.lastScanAt = null;
  state.lastSuccessfulScanAt = null;
  state.lastSkipAt = null;
  state.nextScanAt = null;
  state.scanStartedAt = null;
  state.stocksScanned = 0;
  state.opportunitiesFound = 0;
  state.lastError = null;
  state.pauseReason = null;
  state.scanOutcome = "idle";
  state.notifications = [];
  state.lastResult = null;
  state.marketOpen = null;
  state.workerMode = false;
}
