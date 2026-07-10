/**
 * In-process monitor agent + background worker scheduling.
 * Scans run on a timer independent of page visits when worker auto-start is on.
 */

import { checkOllamaHealth, getAiProviderName } from "@/lib/ai/provider";
import { getMarketClock } from "@/lib/alpaca/client";
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

export type MonitorServiceState = {
  running: boolean;
  scanning: boolean;
  intervalMs: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  scheduleTimer: ReturnType<typeof setTimeout> | null;
  lastScanAt: string | null;
  nextScanAt: string | null;
  stocksScanned: number;
  opportunitiesFound: number;
  lastError: string | null;
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
      nextScanAt: null,
      stocksScanned: 0,
      opportunitiesFound: 0,
      lastError: null,
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
  try {
    const clock = await getMarketClock();
    state.marketOpen = clock.isOpen;
    return clock.isOpen
      ? getMonitorIntervalOpenMs()
      : getMonitorIntervalClosedMs();
  } catch {
    return getMonitorIntervalClosedMs();
  }
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
        marketOpen: false,
        ollamaUsed: false,
        ollamaFallback: false,
        aiProvider: "busy",
        error: "Scan already in progress",
      }
    );
  }

  assertMonitorPaperOnly();
  state.scanning = true;
  emitHeartbeat(state);
  try {
    await refreshOllamaFlag(state);
    const result = await runMonitorScan({ force });
    state.lastResult = result;
    state.lastScanAt = result.scannedAt;
    state.stocksScanned = result.stocksScanned;
    state.opportunitiesFound = result.opportunitiesFound;
    state.lastError = result.error ?? null;
    state.marketOpen = result.marketOpen;
    if (result.notifications.length > 0) {
      state.notifications = [
        ...result.notifications,
        ...state.notifications,
      ].slice(0, 20);
    }
    await emitStatus("scan_completed");
    return result;
  } finally {
    state.scanning = false;
    emitHeartbeat(state);
  }
}

async function buildMonitorStatus(): Promise<MonitorStatus> {
  const state = getMonitorServiceState();
  const active = await readActiveOpportunities();
  const logs = await readMonitorLogs(12);
  const lastScan =
    state.lastResult?.lastScan ?? (await readLastScanSnapshot());
  const top =
    pickTopOpportunity(active) ?? state.lastResult?.topOpportunity ?? null;

  let agentStatus: MonitorStatus["status"] = "stopped";
  if (state.scanning) agentStatus = "scanning";
  else if (state.running) agentStatus = "running";

  const topSignalLabel =
    state.lastResult?.topSignalLabel ??
    formatTopSignalLabel(lastScan) ??
    (top
      ? `Top signal from ${state.stocksScanned || lastScan?.stocksScanned || "?"} scanned symbols: ${top.symbol} · ${top.action}`
      : "No scan yet");

  return {
    ...monitorSafetyFlags(),
    status: agentStatus,
    running: state.running,
    scanning: state.scanning,
    intervalMs: state.intervalMs,
    lastScanAt: state.lastScanAt,
    nextScanAt: state.running ? state.nextScanAt : null,
    stocksScanned: state.stocksScanned,
    scannedSymbols:
      lastScan?.symbols ?? state.lastResult?.symbols ?? [],
    opportunitiesFound: state.opportunitiesFound,
    activeOpportunities: active.length,
    topOpportunity: top,
    topSignalLabel,
    lastError: state.lastError,
    ollamaAvailable: state.ollamaAvailable,
    notifications: state.notifications.slice(0, 8),
    recentLogs: logs,
    workerMode: state.workerMode,
    marketOpen: state.marketOpen,
    heartbeatAt: new Date().toISOString(),
    intervalOpenMs: getMonitorIntervalOpenMs(),
    intervalClosedMs: getMonitorIntervalClosedMs(),
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
  state.nextScanAt = null;
  state.stocksScanned = 0;
  state.opportunitiesFound = 0;
  state.lastError = null;
  state.notifications = [];
  state.lastResult = null;
  state.marketOpen = null;
  state.workerMode = false;
}
