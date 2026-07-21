"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { InfoTip } from "@/components/ui/InfoTip";
import { formatTime } from "@/lib/format";
import {
  buildRuntimeActivity,
  type RuntimeStatusInput,
} from "@/lib/client/runtime-status-mapper";
import { NextScanCountdown } from "@/components/status/NextScanCountdown";
import { ScanStage } from "@/components/status/ScanStage";
import { ScanProgress } from "@/components/status/ScanProgress";
import { LastScanSummary } from "@/components/status/LastScanSummary";
import { ScanDetailsDrawer } from "@/components/status/ScanDetailsDrawer";

function toneClasses(
  tone: "ok" | "warn" | "neutral" | "bad",
): string {
  if (tone === "ok") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-50";
  if (tone === "warn") return "border-amber-500/35 bg-amber-500/10 text-amber-50";
  if (tone === "bad") return "border-red-500/40 bg-red-950/35 text-red-50";
  return "border-[var(--border)] bg-[var(--panel-elevated)]/80 text-zinc-100";
}

export function AutoTradingActivity({
  input,
  opportunitiesFound,
}: {
  input: RuntimeStatusInput;
  opportunitiesFound?: number | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activity = buildRuntimeActivity({ ...input, nowMs });

  return (
    <Panel
      title="Auto-trading activity"
      action={
        activity.serverSideNote ? (
          <InfoTip text="Scanning continues while this browser page is closed, as long as the TradingAI application process remains running." />
        ) : undefined
      }
      className="shadow-sm shadow-black/20"
    >
      <div
        className={`rounded-[var(--radius-sm)] border px-4 py-3 ${toneClasses(activity.tone)}`}
        role="status"
        aria-live="polite"
      >
        <p className="text-lg font-semibold tracking-tight">{activity.title}</p>
        <p className="mt-1 text-sm opacity-90">{activity.detail}</p>
        {activity.kind === "scan_active" ? (
          <div className="mt-2">
            <ScanProgress
              evaluated={null}
              total={null}
              currentSymbol={activity.currentSymbol}
            />
            <ScanStage label={activity.stageLabel} />
          </div>
        ) : (
          <ScanStage label={activity.stageLabel} />
        )}
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {activity.stocksChecked != null ? (
          <div>
            <dt className="text-xs text-[var(--muted)]">Stocks monitored</dt>
            <dd className="tabular-nums text-zinc-100">{activity.stocksChecked}</dd>
          </div>
        ) : null}
        {activity.lastScanAt ? (
          <div>
            <dt className="text-xs text-[var(--muted)]">Last scan</dt>
            <dd className="text-zinc-100">{formatTime(activity.lastScanAt)}</dd>
          </div>
        ) : null}
        {activity.kind === "waiting_next_scan" ||
        activity.kind === "scan_active" ||
        activity.kind === "market_closed" ? (
          <div>
            <dt className="text-xs text-[var(--muted)]">Next scan</dt>
            <dd className="text-zinc-100">
              {activity.nextScanAt ? (
                <NextScanCountdown nextScanAt={activity.nextScanAt} nowMs={nowMs} />
              ) : (
                "Waiting for the monitor’s next scan"
              )}
            </dd>
          </div>
        ) : null}
        {activity.lastUpdateAt ? (
          <div>
            <dt className="text-xs text-[var(--muted)]">Last update</dt>
            <dd className="text-zinc-100">{formatTime(activity.lastUpdateAt)}</dd>
          </div>
        ) : null}
      </dl>

      {(activity.kind === "waiting_next_scan" ||
        activity.kind === "ready" ||
        activity.kind === "scan_failed") &&
      activity.lastScanAt ? (
        <div className="mt-3 space-y-2">
          <LastScanSummary
            stocksChecked={activity.stocksChecked}
            opportunitiesFound={opportunitiesFound}
            completedAt={activity.lastScanAt}
          />
          <ScanDetailsDrawer />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {activity.actions.includes("run_scan") ||
        activity.actions.includes("retry") ? (
          <Link
            href="/monitor"
            className="ui-btn border border-amber-500/40 bg-amber-500/12 text-sm text-amber-50"
          >
            {activity.actions.includes("retry") ? "Retry now" : "Run scan now"}
          </Link>
        ) : null}
        {activity.actions.includes("manage_auto") ? (
          <Link
            href="/auto-trade"
            className="ui-btn border border-emerald-500/40 bg-emerald-500/10 text-sm text-emerald-50"
          >
            Manage auto trading
          </Link>
        ) : null}
        {activity.actions.includes("open_monitor") ? (
          <Link
            href="/monitor"
            className="ui-btn border border-[var(--border)] text-sm"
          >
            Open Advanced Monitoring
          </Link>
        ) : null}
        {activity.actions.includes("review_safety") ? (
          <Link
            href="/auto-trade"
            className="ui-btn border border-[var(--border)] text-sm"
          >
            Review safety status
          </Link>
        ) : null}
      </div>
    </Panel>
  );
}
