"use client";

import { useEffect, useState } from "react";
import { useMonitorStream } from "@/components/layout/MonitorStreamContext";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";
import {
  isOpportunityBlocked,
  monitorTradeStatus,
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

function statusTone(
  status: MonitorStatus["status"],
): "ok" | "warn" | "bad" | "neutral" {
  if (status === "running") return "ok";
  if (status === "scanning") return "warn";
  return "neutral";
}

function primaryMonitorMessage(input: {
  status: MonitorStatus | null;
  marketClosed: boolean;
  scanning: boolean;
}): { message: string; tone: "ok" | "warn" | "neutral" | "info"; detail: string } {
  if (input.marketClosed) {
    return {
      message: "Market is closed",
      tone: "neutral",
      detail: "Monitoring can continue. Paper trading waits until the market opens.",
    };
  }
  if (input.scanning || input.status?.status === "scanning") {
    return {
      message: "Scan in progress",
      tone: "warn",
      detail: "Checking the watchlist for paper-trade setups.",
    };
  }
  if (input.status?.running) {
    return {
      message: "Monitor is active",
      tone: "ok",
      detail: "The agent is watching your watchlist. It never places orders.",
    };
  }
  return {
    message: "Monitor is stopped",
    tone: "neutral",
    detail: "Start monitoring or run a scan when you want fresh setups.",
  };
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
  const marketClosed =
    top?.marketStatus === "closed" ||
    (top != null && primaryBlockReason(top) === "Market closed");
  const primary = primaryMonitorMessage({
    status,
    marketClosed,
    scanning: Boolean(status?.scanning || stream.scanning),
  });

  const stocksMonitored =
    status?.stocksScanned || status?.scannedSymbols?.length || 0;
  const compactTone =
    primary.tone === "ok"
      ? "ok"
      : primary.tone === "warn"
        ? "warn"
        : status?.lastError || error
          ? "bad"
          : "neutral";

  return (
    <div id="monitor" className="scroll-mt-24 flex flex-col gap-4">
      <CompactStatusCard
        title="Monitoring status"
        message={primary.message}
        detail={primary.detail}
        tone={compactTone}
        metrics={[
          {
            label: "Status",
            value: status?.running
              ? status.status === "scanning"
                ? "Scanning"
                : "Running"
              : "Stopped",
          },
          {
            label: "Last scan",
            value: status?.lastScanAt ? formatTime(status.lastScanAt) : "Never",
          },
          {
            label: "Stocks monitored",
            value: String(stocksMonitored),
          },
          {
            label: "Errors",
            value: error || status?.lastError ? "Attention" : "None",
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
              disabled={busy || Boolean(status?.scanning)}
              onClick={() => void postAction("/api/monitor/scan")}
              className="ui-btn min-h-10 border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-100 disabled:opacity-50"
            >
              {status?.scanning ? "Scanning…" : "Run scan"}
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
              <InfoTip text="Scans your watchlist for setups. Monitoring never places orders." />
            </p>
            {error ? (
              <p className="mt-3 rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                {error}
              </p>
            ) : null}
            {status?.lastError ? (
              <p className="mt-2 text-sm text-amber-100/90">
                Last scan note: {status.lastError}
              </p>
            ) : null}
            <MonitorNotifications notifications={notifications} />
            <TopOpportunityCard
              opportunity={top}
              stocksScanned={stocksMonitored}
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
            label="Agent status"
            value={status?.status ?? "—"}
            tone={status ? statusTone(status.status) : "neutral"}
          />
          <Stat
            label="Last scan"
            value={status?.lastScanAt ? formatTime(status.lastScanAt) : "Never"}
          />
          <Stat
            label="Next scan"
            value={
              status?.running && status.nextScanAt
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
            label="Stocks scanned"
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
}: {
  opportunity: MonitorOpportunity | null;
  stocksScanned?: number;
}) {
  if (!opportunity) {
    return (
      <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--muted)]">
        No active setups yet. Start monitoring or run a scan.
      </div>
    );
  }

  const blocked = isOpportunityBlocked(opportunity);
  const tradeStatus = monitorTradeStatus(opportunity);
  const primary = primaryBlockReason(opportunity);
  const marketClosed =
    opportunity.marketStatus === "closed" || primary === "Market closed";

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
        {topSignalHeadline(opportunity)}
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
              tradeStatus === "Ready" ? "text-emerald-200" : "text-amber-100"
            }`}
          >
            {tradeStatus}
          </dd>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/60 bg-[var(--panel)]/40 px-2.5 py-2">
          <dt className="text-xs text-[var(--muted)]">Primary reason</dt>
          <dd className="mt-0.5 font-semibold">
            {tradeStatus === "Ready" ? "None" : (primary ?? "—")}
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-sm text-[var(--foreground)]/85">
        {opportunity.reason}
      </p>

      {marketClosed ? (
        <p className="mt-2 text-sm font-medium text-amber-100">
          Monitoring continues. Trading waits until market opens.
        </p>
      ) : null}

      <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
        Setups can be detected anytime, but paper orders still need market, data,
        and risk checks to pass.
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
