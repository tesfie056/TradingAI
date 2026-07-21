"use client";

import { useEffect, useRef, useState } from "react";
import { useMonitorStream } from "@/components/layout/MonitorStreamContext";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";
import {
  autoTradeUiLabel,
  buildAgentLiveSnapshot,
  type AutoTradeUiStatus,
} from "@/lib/auto-trade/display";
import type { AutoTradeStatus } from "@/lib/auto-trade/types";
import type { MonitorStatus } from "@/lib/monitor/types";
import { StatusDot } from "@/components/ui/SafetyStrip";

function toneForAuto(status: AutoTradeUiStatus): "ok" | "warn" | "bad" | "neutral" {
  if (status === "placed") return "ok";
  if (status === "skipped" || status === "waiting") return "warn";
  if (status === "rejected") return "bad";
  return "neutral";
}

type RowProps = { label: string; value: string; highlight?: boolean };

function Row({ label, value, highlight }: RowProps) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span
        className={
          highlight
            ? "font-semibold text-amber-50"
            : "font-medium text-[var(--foreground)]"
        }
      >
        {value}
      </span>
    </div>
  );
}

export function AgentLiveStatus() {
  const stream = useMonitorStream();
  const monitor = stream.status;
  const [autoTrade, setAutoTrade] = useState<AutoTradeStatus | null>(null);
  const lastScanRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchJson<AutoTradeStatus>("/api/auto-trade")
        .then((next) => {
          if (!cancelled) setAutoTrade(next);
        })
        .catch(() => {
          if (!cancelled) setAutoTrade(null);
        });
    };
    const id = window.setTimeout(load, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    const last = monitor?.lastScanAt;
    if (!last || last === lastScanRef.current) return;
    lastScanRef.current = last;
    const id = window.setTimeout(() => {
      void fetchJson<AutoTradeStatus>("/api/auto-trade").then(setAutoTrade);
    }, 0);
    return () => window.clearTimeout(id);
  }, [monitor?.lastScanAt]);

  const snapshot = buildAgentLiveSnapshot({
    monitor: monitor ?? null,
    scanning: stream.scanning || monitor?.scanning === true,
    autoEnabled: autoTrade?.effectivelyEnabled ?? false,
    recentDecisions: autoTrade?.recentDecisions ?? [],
    scannedCount:
      autoTrade?.lastScan?.stocksScanned ??
      monitor?.stocksScanned ??
      monitor?.scannedSymbols?.length ??
      0,
    topSignalLabel:
      autoTrade?.topSignalLabel ?? monitor?.topSignalLabel ?? null,
  });

  const paused = Boolean(monitor?.enginePaused || monitor?.scanOutcome === "paused");
  const scanning =
    !paused && (stream.scanning || monitor?.scanning === true);
  const scannedList =
    autoTrade?.lastScan?.symbols ?? monitor?.scannedSymbols ?? [];
  const watchlistSize =
    monitor?.watchlistSize ??
    scannedList.length ??
    autoTrade?.lastScan?.stocksScanned ??
    0;

  return (
    <div className="rounded-[var(--radius-sm)] border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-[var(--panel-elevated)]/40 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <StatusDot
          tone={
            paused
              ? "warn"
              : scanning
                ? "warn"
                : stream.workerRunning
                  ? "ok"
                  : "neutral"
          }
        />
        <span className="text-sm font-semibold tracking-wide text-amber-50">
          {paused ? "Engine paused" : scanning ? "Scanning now…" : "Agent live"}
        </span>
        {stream.connected ? (
          <span className="text-xs text-emerald-200/80">SSE</span>
        ) : (
          <span className="text-xs text-[var(--muted)]">reconnecting</span>
        )}
      </div>

      <div className="grid gap-1.5">
        <Row
          label="Last scan"
          value={snapshot.lastScan ? formatTime(snapshot.lastScan) : "Never"}
        />
        <Row
          label="Next scan"
          value={
            monitor?.running && snapshot.nextScan
              ? formatTime(snapshot.nextScan)
              : monitor?.running
                ? "Pending"
                : "—"
          }
        />
        <Row
          label="Watchlist"
          value={
            watchlistSize > 0
              ? `${watchlistSize} stocks`
              : paused
                ? "Paused — not scanning"
                : "—"
          }
        />
        <Row
          label="Watchlist scanned"
          value={
            scannedList.length > 0
              ? `${scannedList.length}: ${scannedList.join(", ")}`
              : snapshot.scannedCount > 0
                ? `${snapshot.scannedCount} symbols`
                : "—"
          }
        />
        <Row
          label="Top signal"
          value={
            paused
              ? "Scanning suspended — engine paused"
              : snapshot.topSignalLabel
          }
          highlight={!paused && snapshot.topSymbol !== "—"}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-[var(--muted)]">Auto trade status</span>
          <span className="inline-flex items-center gap-1.5 font-semibold capitalize">
            <StatusDot tone={toneForAuto(snapshot.autoStatus)} />
            {autoTradeUiLabel(snapshot.autoStatus)}
          </span>
        </div>
        <Row
          label="Reason"
          value={
            paused
              ? (monitor?.pauseReason ?? monitor?.lastError ?? snapshot.reason)
              : snapshot.reason
          }
        />
      </div>
    </div>
  );
}

/** Compact variant for dashboard strips */
export function AgentLiveStatusCompact({
  monitor,
}: {
  monitor?: MonitorStatus | null;
}) {
  const stream = useMonitorStream();
  const status = monitor ?? stream.status;
  const paused = Boolean(status?.enginePaused || status?.scanOutcome === "paused");
  const scanning = !paused && (stream.scanning || status?.scanning);

  return (
    <p className="text-sm text-[var(--muted)]">
      {paused
        ? `Engine paused${status?.pauseReason ? ` · ${status.pauseReason}` : ""}`
        : scanning
          ? "Scanning now…"
          : status?.lastScanAt
            ? `Last scan ${formatTime(status.lastScanAt)}`
            : "No scan yet"}
      {!paused && status?.topSignalLabel
        ? ` · ${status.topSignalLabel}`
        : !paused && status?.topOpportunity
          ? ` · Top from ${status.stocksScanned || "?"} scanned: ${status.topOpportunity.symbol}`
          : null}
    </p>
  );
}
