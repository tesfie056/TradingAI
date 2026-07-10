/**
 * Simple in-process rate limiter for monitor scans.
 * Intervals prefer runtime settings; env seeds defaults.
 * Never logs secrets.
 */

import { getEffectiveRuntimeSettings } from "@/lib/auto-trade/runtime-settings/service";

let lastScanStartedAt = 0;

export function getMonitorMinScanGapMs(): number {
  const raw = process.env.MONITOR_MIN_SCAN_GAP_MS;
  const n = raw != null && raw.trim() !== "" ? Number(raw) : 60_000;
  if (!Number.isFinite(n) || n < 5_000) return 60_000;
  return Math.floor(n);
}

export function getMonitorIntervalMs(): number {
  const raw = process.env.MONITOR_INTERVAL_MS;
  const n = raw != null && raw.trim() !== "" ? Number(raw) : 5 * 60_000;
  if (!Number.isFinite(n) || n < 60_000) return 5 * 60_000;
  return Math.floor(n);
}

/** Scan interval while US market is open. */
export function getMonitorIntervalOpenMs(): number {
  const n = getEffectiveRuntimeSettings().scanIntervalOpenMs;
  return n < 60_000 ? 90_000 : n;
}

/** Scan interval after market close. */
export function getMonitorIntervalClosedMs(): number {
  const n = getEffectiveRuntimeSettings().scanIntervalClosedMs;
  return n < 60_000 ? 900_000 : n;
}

export function getMonitorHeartbeatMs(): number {
  const raw = process.env.MONITOR_HEARTBEAT_MS;
  const n = raw != null && raw.trim() !== "" ? Number(raw) : 5_000;
  if (!Number.isFinite(n) || n < 2_000) return 5_000;
  return Math.floor(n);
}

export function isMonitorWorkerAutoStart(): boolean {
  return process.env.MONITOR_WORKER_AUTO_START !== "false";
}

export function canStartMonitorScan(now = Date.now()): {
  ok: boolean;
  retryAfterMs: number;
} {
  const gap = getMonitorMinScanGapMs();
  const elapsed = now - lastScanStartedAt;
  if (lastScanStartedAt > 0 && elapsed < gap) {
    return { ok: false, retryAfterMs: gap - elapsed };
  }
  return { ok: true, retryAfterMs: 0 };
}

export function markMonitorScanStarted(now = Date.now()): void {
  lastScanStartedAt = now;
}

/** Test helper — reset rate limiter between verifies. */
export function resetMonitorRateLimitForTests(): void {
  lastScanStartedAt = 0;
}
