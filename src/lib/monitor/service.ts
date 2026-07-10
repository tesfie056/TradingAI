/**
 * In-process Phase 7 monitoring agent.
 * Start/stop interval scans. Never places orders.
 *
 * Note: interval lives in the Node process (dev/server). It does not
 * survive serverless cold starts — use "Run scan now" as a fallback.
 */

import { checkOllamaHealth, getAiProviderName } from "@/lib/ai/provider";
import { appendMonitorLog, readMonitorLogs } from "@/lib/monitor/logs";
import {
  pickTopOpportunity,
  readActiveOpportunities,
} from "@/lib/monitor/queue";
import { getMonitorIntervalMs } from "@/lib/monitor/rate-limit";
import { runMonitorScan, type MonitorScanResult } from "@/lib/monitor/scanner";
import { assertMonitorCannotTrade, monitorSafetyFlags } from "@/lib/monitor/safety";
import type {
  MonitorNotification,
  MonitorStatus,
} from "@/lib/monitor/types";

type InternalState = {
  running: boolean;
  scanning: boolean;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  lastScanAt: string | null;
  nextScanAt: string | null;
  stocksScanned: number;
  opportunitiesFound: number;
  lastError: string | null;
  ollamaAvailable: boolean | null;
  notifications: MonitorNotification[];
  lastResult: MonitorScanResult | null;
};

const globalKey = "__tradingai_monitor_service__";

function getState(): InternalState {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: InternalState;
  };
  if (!g[globalKey]) {
    g[globalKey] = {
      running: false,
      scanning: false,
      intervalMs: getMonitorIntervalMs(),
      timer: null,
      lastScanAt: null,
      nextScanAt: null,
      stocksScanned: 0,
      opportunitiesFound: 0,
      lastError: null,
      ollamaAvailable: null,
      notifications: [],
      lastResult: null,
    };
  }
  return g[globalKey]!;
}

async function refreshOllamaFlag(state: InternalState): Promise<void> {
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

async function executeScan(force = false): Promise<MonitorScanResult> {
  const state = getState();
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
        notifications: [],
        marketOpen: false,
        ollamaUsed: false,
        ollamaFallback: false,
        aiProvider: "busy",
        error: "Scan already in progress",
      }
    );
  }

  assertMonitorCannotTrade();
  state.scanning = true;
  try {
    await refreshOllamaFlag(state);
    const result = await runMonitorScan({ force });
    state.lastResult = result;
    state.lastScanAt = result.scannedAt;
    state.stocksScanned = result.stocksScanned;
    state.opportunitiesFound = result.opportunitiesFound;
    state.lastError = result.error ?? null;
    if (result.notifications.length > 0) {
      state.notifications = [
        ...result.notifications,
        ...state.notifications,
      ].slice(0, 20);
    }
    if (state.running) {
      state.nextScanAt = new Date(
        Date.now() + state.intervalMs,
      ).toISOString();
    }
    return result;
  } finally {
    state.scanning = false;
  }
}

export async function startMonitor(): Promise<MonitorStatus> {
  assertMonitorCannotTrade();
  const state = getState();
  state.intervalMs = getMonitorIntervalMs();

  if (state.running) {
    return getMonitorStatus();
  }

  state.running = true;
  state.nextScanAt = new Date(Date.now() + 1_000).toISOString();
  await appendMonitorLog({
    event: "monitor_started",
    message: `Monitoring agent started (interval ${Math.round(state.intervalMs / 1000)}s) — no auto trading`,
    meta: { intervalMs: state.intervalMs },
  });

  // Kick off first scan shortly after start
  void executeScan(true);

  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    void executeScan(false);
  }, state.intervalMs);

  // Avoid keeping the event loop alive solely for the monitor in some hosts
  if (typeof state.timer === "object" && "unref" in state.timer) {
    state.timer.unref?.();
  }

  return getMonitorStatus();
}

export async function stopMonitor(): Promise<MonitorStatus> {
  const state = getState();
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.running = false;
  state.nextScanAt = null;
  await appendMonitorLog({
    event: "monitor_stopped",
    message: "Monitoring agent stopped",
  });
  return getMonitorStatus();
}

export async function scanMonitorNow(): Promise<{
  status: MonitorStatus;
  scan: MonitorScanResult;
}> {
  const scan = await executeScan(true);
  return { status: await getMonitorStatus(), scan };
}

export async function getMonitorStatus(): Promise<MonitorStatus> {
  const state = getState();
  const active = await readActiveOpportunities();
  const logs = await readMonitorLogs(12);
  const top =
    pickTopOpportunity(active) ?? state.lastResult?.topOpportunity ?? null;

  let agentStatus: MonitorStatus["status"] = "stopped";
  if (state.scanning) agentStatus = "scanning";
  else if (state.running) agentStatus = "running";

  return {
    ...monitorSafetyFlags(),
    status: agentStatus,
    running: state.running,
    scanning: state.scanning,
    intervalMs: state.intervalMs,
    lastScanAt: state.lastScanAt,
    nextScanAt: state.running ? state.nextScanAt : null,
    stocksScanned: state.stocksScanned,
    opportunitiesFound: state.opportunitiesFound,
    activeOpportunities: active.length,
    topOpportunity: top,
    lastError: state.lastError,
    ollamaAvailable: state.ollamaAvailable,
    notifications: state.notifications.slice(0, 8),
    recentLogs: logs,
  };
}

/** Test helper */
export function resetMonitorServiceForTests(): void {
  const state = getState();
  if (state.timer) clearInterval(state.timer);
  state.running = false;
  state.scanning = false;
  state.timer = null;
  state.lastScanAt = null;
  state.nextScanAt = null;
  state.stocksScanned = 0;
  state.opportunitiesFound = 0;
  state.lastError = null;
  state.notifications = [];
  state.lastResult = null;
}
