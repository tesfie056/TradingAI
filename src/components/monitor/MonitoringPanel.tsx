"use client";

import { useEffect, useState } from "react";
import { useMonitorStream } from "@/components/layout/MonitorStreamContext";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";
import {
  isOpportunityBlocked,
  monitorTradeStatus,
  opportunityDetailLine,
  primaryBlockReason,
  topSignalHeadline,
} from "@/lib/monitor/display";
import type {
  MonitorLogEntry,
  MonitorNotification,
  MonitorOpportunity,
  MonitorStatus,
} from "@/lib/monitor/types";
import { CompactStatusCard } from "@/components/ui/CompactStatusCard";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { InfoTip } from "@/components/ui/InfoTip";
import { StatusDot } from "@/components/ui/SafetyStrip";
import { AgentLiveStatus } from "@/components/monitor/AgentLiveStatus";

type MonitorApi = MonitorStatus & {
  ok?: boolean;
  message?: string;
  error?: string;
  scan?: { opportunitiesFound?: number; error?: string };
};

function genuinelyScanning(status: MonitorStatus | null, streamScanning: boolean): boolean {
  if (status?.enginePaused) return false;
  if (status?.scanOutcome === "paused") return false;
  if (status?.scanStalled) return false;
  return Boolean(status?.scanning || streamScanning);
}

function primaryMonitorMessage(input: {
  status: MonitorStatus | null;
  marketClosed: boolean;
  marketUnavailable: boolean;
  scanning: boolean;
}): { message: string; tone: "ok" | "warn" | "neutral" | "info" | "bad"; detail: string } {
  const s = input.status;
  if (s?.scanStalled || s?.scanOutcome === "stalled") {
    return {
      message: "Scan appears stalled",
      tone: "bad",
      detail: s.scanStartedAt
        ? `No progress update since ${formatTime(s.scanStartedAt)}. Retry after the lock clears, or restart the monitor.`
        : "A scan flag stayed active without progress. Retry when ready.",
    };
  }
  if (s?.enginePaused || s?.scanOutcome === "paused") {
    return {
      message: "Engine paused",
      tone: "warn",
      detail:
        s.pauseReason ??
        s.lastError ??
        "New entries are paused. Resume Engine from Auto Trading to allow scans.",
    };
  }
  if (s?.scanOutcome === "failed" && s.lastError) {
    return {
      message: "Scan failed",
      tone: "bad",
      detail: s.lastError,
    };
  }
  if (input.scanning) {
    return {
      message: "Scan in progress",
      tone: "warn",
      detail: s?.scanStartedAt
        ? `Scanning watchlist. Started ${formatTime(s.scanStartedAt)}.`
        : "Checking the watchlist for paper-trade setups.",
    };
  }
  if (input.marketUnavailable) {
    return {
      message: "Market status unavailable",
      tone: "warn",
      detail:
        s?.clockError?.trim() ||
        "Broker clock could not be confirmed. New paper orders stay blocked until market status is available.",
    };
  }
  if (input.marketClosed) {
    return {
      message: "Market is closed",
      tone: "neutral",
      detail: "Monitoring can continue. Paper trading waits until the market opens.",
    };
  }
  if (s?.running) {
    return {
      message: "Monitor is active",
      tone: "ok",
      detail: s.nextScanAt
        ? `Waiting for the next scan at ${formatTime(s.nextScanAt)}.`
        : "The agent is watching your watchlist and handing eligible setups to Auto Trading.",
    };
  }
  return {
    message: "Monitor is stopped",
    tone: "neutral",
    detail: "Start monitoring or run a scan when you want fresh setups.",
  };
}

function scanLabel(status: MonitorStatus | null, scanning: boolean): string {
  if (status?.enginePaused || status?.scanOutcome === "paused") return "Paused";
  if (status?.scanStalled || status?.scanOutcome === "stalled") return "Stalled";
  if (scanning || status?.scanOutcome === "scanning") return "Scanning";
  if (status?.scanOutcome === "failed") return "Failed";
  if (status?.scanOutcome === "completed") return "Completed";
  if (status?.running) return "Scheduled";
  return "Idle";
}

function engineLabel(status: MonitorStatus | null): string {
  if (status?.enginePaused) return "Paused";
  if (status?.scanOutcome === "failed" && status.lastError) return "Error";
  if (status?.running) return "Ready";
  return "Idle";
}

export function MonitoringPanel() {
  const stream = useMonitorStream();
  const [localStatus, setLocalStatus] = useState<MonitorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = stream.status ?? localStatus;

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const next = await fetchJson<MonitorStatus>("/api/monitor");
      setLocalStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (stream.status || localStatus) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      void fetchJson<MonitorStatus>("/api/monitor")
        .then((next) => {
          if (!cancelled) setLocalStatus(next);
        })
        .catch((err) => {
          if (!cancelled) {
            setError(
              err instanceof Error ? err.message : "Failed to load monitor",
            );
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [stream.status, localStatus]);

  async function postAction(path: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<MonitorApi>(path, { method: "POST" });
      if (res.error && !res.ok) setError(res.error);
      setLocalStatus((prev) => ({
        ...(prev ?? emptyStatus()),
        ...res,
        paperOnly: true,
        canPlaceOrders: false,
      }));
      stream.reconnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Monitor action failed");
    } finally {
      setBusy(false);
    }
  }

  const top = status?.topOpportunity ?? null;
  const notifications = status?.notifications ?? [];
  const logs = status?.recentLogs ?? [];
  const marketUnavailable =
    status?.marketSessionStatus === "unavailable" ||
    status?.marketOpen === null ||
    top?.marketStatus === "unavailable" ||
    (top != null &&
      primaryBlockReason(top, { marketOpen: status?.marketOpen }) ===
        "Market status unavailable");
  const marketClosed =
    !marketUnavailable &&
    (status?.marketOpen === false ||
      top?.marketStatus === "closed" ||
      (top != null &&
        primaryBlockReason(top, { marketOpen: status?.marketOpen }) ===
          "Market closed"));
  const scanning = genuinelyScanning(status, stream.scanning);
  const primary = primaryMonitorMessage({
    status,
    marketClosed,
    marketUnavailable,
    scanning,
  });

  const watchlistCount =
    status?.watchlistSize ??
    status?.scannedSymbols?.length ??
    status?.stocksScanned ??
    0;
  const stocksChecked =
    status?.stocksScanned || status?.scannedSymbols?.length || 0;
  const hasHardError =
    Boolean(error) ||
    status?.scanOutcome === "failed" ||
    status?.scanStalled === true;
  const compactTone =
    primary.tone === "ok"
      ? "ok"
      : primary.tone === "warn"
        ? "warn"
        : primary.tone === "bad" || hasHardError
          ? "bad"
          : "neutral";

  const runScanDisabled =
    busy ||
    scanning ||
    Boolean(status?.enginePaused) ||
    status?.scanOutcome === "paused";
  const runScanLabel = scanning
    ? "Scanning…"
    : status?.enginePaused || status?.scanOutcome === "paused"
      ? "Paused"
      : status?.scanOutcome === "failed" || status?.scanStalled
        ? "Retry scan"
        : "Run scan";

  return (
    <div id="monitor" className="scroll-mt-24 flex flex-col gap-4">
      <CompactStatusCard
        title="Monitoring status"
        message={primary.message}
        detail={primary.detail}
        tone={compactTone}
        metrics={[
          {
            label: "Monitor",
            value: status?.running
              ? status.scanOutcome === "failed"
                ? "Failed"
                : "Running"
              : "Stopped",
          },
          {
            label: "Engine",
            value: engineLabel(status),
          },
          {
            label: "Scan",
            value: scanLabel(status, scanning),
          },
          {
            label: "Watchlist",
            value:
              watchlistCount > 0
                ? `${watchlistCount} stocks`
                : status?.enginePaused
                  ? "Unavailable while paused"
                  : "Unavailable",
          },
          {
            label: "Last scan",
            value: status?.lastScanAt
              ? formatTime(status.lastScanAt)
              : status?.lastSkipAt
                ? `Skip ${formatTime(status.lastSkipAt)}`
                : "Never",
          },
          {
            label: "Errors",
            value: hasHardError
              ? "Attention required"
              : status?.enginePaused
                ? "Paused"
                : "None",
          },
        ]}
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || status?.running}
              onClick={() => void postAction("/api/monitor/start")}
              className="ui-btn min-h-10 border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-100 disabled:opacity-50"
            >
              Start
            </button>
            <button
              type="button"
              disabled={busy || !status?.running}
              onClick={() => void postAction("/api/monitor/stop")}
              className="ui-btn min-h-10 border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--muted)] disabled:opacity-50"
            >
              Stop
            </button>
            <button
              type="button"
              disabled={runScanDisabled}
              onClick={() => void postAction("/api/monitor/scan")}
              className="ui-btn min-h-10 border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-100 disabled:opacity-50"
            >
              {runScanLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
              className="ui-btn min-h-10 border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--muted)] disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        }
        footer={
          <>
            <p className="mt-3 text-sm text-[var(--muted)]">
              Monitoring controls
              <InfoTip text="Advanced Monitoring analyzes stocks. When Auto Trading and Paper Execution are enabled, eligible setups are handled by the Auto Trading engine." />
            </p>
            {error ? (
              <p className="mt-3 rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                {error}
              </p>
            ) : null}
            {status?.enginePaused && status.pauseReason ? (
              <p className="mt-2 text-sm text-amber-100/90">
                Pause reason: {status.pauseReason}
              </p>
            ) : null}
            {!status?.enginePaused &&
            status?.lastError &&
            status.scanOutcome === "failed" ? (
              <p className="mt-2 text-sm text-rose-100/90">
                Last scan error: {status.lastError}
              </p>
            ) : null}
            {scanning ? (
              <p className="mt-2 text-sm text-zinc-200">
                Scanning watchlist
                {watchlistCount > 0 ? ` (${watchlistCount} stocks)` : ""}.
                {status?.scanStartedAt
                  ? ` Started ${formatTime(status.scanStartedAt)}.`
                  : ""}{" "}
                Waiting for the next engine update.
              </p>
            ) : null}
            <LastScanResultSummary
              summary={status?.scanSummary}
              stocksChecked={stocksChecked}
              lastScanAt={status?.lastScanAt}
            />
            <MonitorNotifications notifications={notifications} />
            <TopOpportunityCard
              opportunity={top}
              stocksScanned={stocksChecked}
              enginePaused={Boolean(status?.enginePaused)}
              marketOpen={status?.marketOpen ?? null}
            />
          </>
        }
      />

      <ExpandableSection
        title="Scan details"
        expandLabel="View scan details"
        collapseLabel="Hide scan details"
        tip={
          <InfoTip text="Timing and counts from the latest watchlist scans." />
        }
        summary="Last scan, interval, stocks scanned, and setups found."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Monitor"
            value={status?.running ? "Running" : "Stopped"}
            tone={status?.running ? "ok" : "neutral"}
          />
          <Stat
            label="Engine"
            value={engineLabel(status)}
            tone={status?.enginePaused ? "warn" : "ok"}
          />
          <Stat
            label="Market"
            value={
              status?.marketOpen === true
                ? "Open"
                : status?.marketOpen === false
                  ? "Closed"
                  : "Unavailable"
            }
            tone={
              status?.marketOpen === true
                ? "ok"
                : status?.marketOpen === false
                  ? "neutral"
                  : "warn"
            }
          />
          <Stat
            label="Scan"
            value={scanLabel(status, scanning)}
            tone={
              status?.enginePaused
                ? "warn"
                : scanning
                  ? "warn"
                  : status?.scanOutcome === "failed"
                    ? "bad"
                    : "neutral"
            }
          />
          <Stat
            label="Watchlist"
            value={
              (status?.watchlistSize ?? 0) > 0
                ? `${status?.watchlistSize} stocks`
                : "Unavailable"
            }
          />
          <Stat
            label="Last successful scan"
            value={status?.lastScanAt ? formatTime(status.lastScanAt) : "Never"}
          />
          <Stat
            label="Next scan"
            value={
              status?.enginePaused
                ? "Paused"
                : status?.running && status.nextScanAt
                  ? formatTime(status.nextScanAt)
                  : status?.running
                    ? "Pending"
                    : "—"
            }
          />
          <Stat
            label="Interval"
            value={
              !status
                ? "—"
                : status.marketOpen
                  ? `${Math.round((status.intervalOpenMs ?? status.intervalMs) / 1000)}s (open)`
                  : `${Math.round((status.intervalClosedMs ?? status.intervalMs) / 60000)}m (closed)`
            }
          />
          <Stat
            label="Stocks checked (last)"
            value={String(status?.stocksScanned ?? 0)}
          />
          <Stat
            label="Setups found"
            value={String(
              status?.opportunitiesFound ?? status?.activeOpportunities ?? 0,
            )}
          />
          <Stat
            label="Active queue"
            value={String(status?.activeOpportunities ?? 0)}
          />
        </div>
      </ExpandableSection>

      <ExpandableSection
        title="Connection details"
        expandLabel="View connection details"
        collapseLabel="Hide connection details"
        tip={
          <InfoTip text="Live connection, auto-trade snapshot, and assistant availability." />
        }
        summary="Live updates, assistant availability, and auto-trade snapshot."
      >
        <div className="mb-4 flex flex-wrap gap-2 text-sm text-[var(--muted)]">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ${
              stream.connected
                ? "ring-emerald-500/40 text-emerald-100"
                : "ring-[var(--border)]"
            }`}
          >
            <StatusDot tone={stream.connected ? "ok" : "bad"} />
            Live updates {stream.connected ? "connected" : "reconnecting…"}
          </span>
          {stream.heartbeatAt ? (
            <span>Last heartbeat {formatTime(stream.heartbeatAt)}</span>
          ) : null}
          {status?.workerMode ? (
            <span className="text-amber-100/90">Background worker active</span>
          ) : null}
          <span>
            Assistant:{" "}
            {status?.ollamaAvailable == null
              ? "—"
              : status.ollamaAvailable
                ? "Available"
                : "Using fallback"}
          </span>
        </div>
        <AgentLiveStatus />
      </ExpandableSection>

      <ExpandableSection
        title="Monitoring logs"
        expandLabel="View monitoring logs"
        collapseLabel="Hide monitoring logs"
        tip={<InfoTip text="Recent monitor events for troubleshooting." />}
        summary="Recent scan and agent log lines."
      >
        <MonitorLogList logs={logs} />
      </ExpandableSection>
    </div>
  );
}

function LastScanResultSummary({
  summary,
  stocksChecked,
  lastScanAt,
}: {
  summary: MonitorStatus["scanSummary"];
  stocksChecked: number;
  lastScanAt?: string | null;
}) {
  if (!summary && !(stocksChecked > 0 && lastScanAt)) return null;
  return (
    <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border)]/80 bg-[var(--panel-elevated)]/40 px-3 py-2 text-xs text-zinc-300">
      <p className="font-medium text-zinc-100">Last scan completed</p>
      {summary ? (
        <ul className="mt-1 space-y-0.5">
          <li>{summary.stocksReceived} stocks received</li>
          <li>{summary.stocksEvaluated} evaluated</li>
          {summary.missingData > 0 ? (
            <li>{summary.missingData} missing current data</li>
          ) : null}
          {summary.rejectedBySignal > 0 ? (
            <li>{summary.rejectedBySignal} did not meet entry rules</li>
          ) : null}
          {summary.rejectedBySpread > 0 ? (
            <li>{summary.rejectedBySpread} rejected by spread</li>
          ) : null}
          {summary.rejectedBySafety > 0 ? (
            <li>{summary.rejectedBySafety} blocked by safety</li>
          ) : null}
          {summary.alreadyHeld > 0 ? (
            <li>{summary.alreadyHeld} already held</li>
          ) : null}
          <li>
            {summary.eligible} eligible · {summary.ordersSubmitted} orders
            submitted
          </li>
          {summary.eligible === 0 ? (
            <li>No stocks met all entry rules</li>
          ) : null}
          <li>Completed at {formatTime(summary.completedAt)}</li>
        </ul>
      ) : (
        <ul className="mt-1 space-y-0.5">
          <li>{stocksChecked} stocks checked</li>
          {lastScanAt ? <li>Completed at {formatTime(lastScanAt)}</li> : null}
        </ul>
      )}
    </div>
  );
}

function emptyStatus(): MonitorStatus {
  return {
    paperOnly: true,
    canPlaceOrders: false,
    automaticTradingAllowed: false,
    status: "stopped",
    running: false,
    scanning: false,
    intervalMs: 300_000,
    lastScanAt: null,
    nextScanAt: null,
    stocksScanned: 0,
    scannedSymbols: [],
    opportunitiesFound: 0,
    activeOpportunities: 0,
    topOpportunity: null,
    topSignalLabel: "No scan yet",
    lastError: null,
    ollamaAvailable: null,
    notifications: [],
    recentLogs: [],
    enginePaused: false,
    pauseReason: null,
    scanOutcome: "idle",
    watchlistSize: 0,
    scanSummary: null,
  };
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/70 bg-[var(--panel-elevated)]/40 px-3 py-2">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold capitalize">
        <StatusDot tone={tone} />
        {value}
      </div>
    </div>
  );
}

export function MonitorNotifications({
  notifications,
}: {
  notifications: MonitorNotification[];
}) {
  if (notifications.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-col gap-1.5">
      {notifications.slice(0, 4).map((n) => (
        <li
          key={n.id}
          className={`rounded-[var(--radius-sm)] border px-3 py-2 text-sm ${
            n.kind === "ready_for_preview"
              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-50"
              : n.kind.startsWith("blocked")
                ? "border-amber-500/35 bg-amber-500/10 text-amber-50"
                : "border-[var(--border)] bg-[var(--panel-elevated)]/50"
          }`}
        >
          <p className="font-semibold">{n.title}</p>
          <p className="mt-0.5 text-xs opacity-90">{n.detail}</p>
        </li>
      ))}
    </ul>
  );
}

function TopOpportunityCard({
  opportunity,
  stocksScanned,
  enginePaused,
  marketOpen,
}: {
  opportunity: MonitorOpportunity | null;
  stocksScanned?: number;
  enginePaused?: boolean;
  marketOpen?: boolean | null;
}) {
  if (!opportunity) {
    return (
      <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--muted)]">
        No active setups yet. Start monitoring or run a scan.
      </div>
    );
  }

  const ctx = { enginePaused, marketOpen };
  const blocked = isOpportunityBlocked(opportunity, ctx);
  const tradeStatus = monitorTradeStatus(opportunity, ctx);
  const primary = primaryBlockReason(opportunity, ctx);
  const marketClosed = tradeStatus === "Waiting for market";
  const eligible = tradeStatus === "Trade eligible" && !enginePaused;

  return (
    <div
      className={`mt-4 rounded-[var(--radius-sm)] border px-3.5 py-3 ${
        blocked
          ? "border-amber-500/35 bg-amber-500/5"
          : "border-emerald-500/30 bg-emerald-500/5"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--muted)]">
          Top signal
          {stocksScanned && stocksScanned > 0
            ? ` from ${stocksScanned} scanned`
            : ""}
        </h3>
        <span className="text-xs text-[var(--muted)]">
          {formatTime(opportunity.timestamp)} · expires{" "}
          {formatTime(opportunity.expiresAt)}
        </span>
      </div>

      <p className="mt-1.5 text-base font-semibold leading-snug">
        {topSignalHeadline(opportunity, ctx)}
        {blocked && primary ? (
          <span className="ml-2 text-sm font-semibold text-amber-100">
            · {primary}
          </span>
        ) : null}
      </p>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/60 bg-[var(--panel)]/40 px-2.5 py-2">
          <dt className="text-xs text-[var(--muted)]">Signal</dt>
          <dd className="mt-0.5 font-semibold">{opportunity.action}</dd>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/60 bg-[var(--panel)]/40 px-2.5 py-2">
          <dt className="text-xs text-[var(--muted)]">Trade status</dt>
          <dd
            className={`mt-0.5 font-semibold ${
              eligible ? "text-emerald-200" : "text-amber-100"
            }`}
          >
            {tradeStatus}
          </dd>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/60 bg-[var(--panel)]/40 px-2.5 py-2">
          <dt className="text-xs text-[var(--muted)]">Primary reason</dt>
          <dd className="mt-0.5 font-semibold">
            {eligible ? "None" : (primary ?? "—")}
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-sm text-[var(--foreground)]/85">
        {opportunityDetailLine(opportunity, ctx)}
      </p>

      {marketClosed ? (
        <p className="mt-2 text-sm font-medium text-amber-100">
          Waiting for market open before paper-order submission. A fresh
          eligibility check runs after the opening delay.
        </p>
      ) : null}

      <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
        Advanced Monitoring finds setups. Auto Trading places Alpaca paper orders
        when Paper Execution and Auto Trading are enabled and all checks pass.
      </p>
    </div>
  );
}

function MonitorLogList({ logs }: { logs: MonitorLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">No monitor logs yet.</p>
    );
  }
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
      {logs.map((l) => (
        <li
          key={l.id}
          className="rounded border border-[var(--border)]/50 px-2 py-1.5"
        >
          <span className="text-[var(--muted)]">
            {formatTime(l.timestamp)} · {l.event}
          </span>
          <span className="ml-2">{l.message}</span>
        </li>
      ))}
    </ul>
  );
}
