/**
 * Simple in-process rate limiter for monitor scans.
 * Never logs secrets.
 */

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
