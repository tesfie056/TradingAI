"use client";

import { useEffect, useState } from "react";
import { useMonitorStream } from "@/components/layout/MonitorStreamContext";
import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";
import { fetchJson } from "@/lib/client/fetch-json";
import {
  buildOrderPipelineView,
  type OrderPipelineView,
} from "@/lib/auto-trade/order-pipeline";
import type { AutoTradeStatus } from "@/lib/auto-trade/types";

export function OrderAutomationPipeline({
  status,
}: {
  status: AutoTradeStatus | null;
}) {
  const stream = useMonitorStream();
  const [view, setView] = useState<OrderPipelineView | null>(null);

  useEffect(() => {
    const top = stream.status?.topOpportunity ?? null;
    const recent = status?.recentDecisions?.[0] ?? null;
    const matched =
      (top &&
        status?.recentDecisions?.find(
          (d) => d.symbol.toUpperCase() === top.symbol.toUpperCase(),
        )) ??
      recent;

    setView(
      buildOrderPipelineView({
        scanning: stream.scanning || stream.status?.scanning,
        marketOpen:
          stream.marketOpen ??
          stream.status?.marketOpen ??
          status?.trader?.marketOpen ??
          null,
        autoTradingEnabled:
          status?.engine?.autoTradingEnabled ?? status?.envEnabled ?? false,
        executionEnabled:
          status?.engine?.executionEnabled ?? status?.executionEnabled ?? false,
        enginePaused: Boolean(
          status?.runtimeDisabled ||
            stream.status?.enginePaused ||
            status?.engine?.engineState === "PAUSED" ||
            status?.engine?.engineState === "EMERGENCY_STOPPED",
        ),
        pauseReason:
          stream.status?.pauseReason ??
          status?.engine?.blockingReasons?.[0] ??
          null,
        topOpportunity: top,
        recentDecision: matched,
        protectionActive: Boolean(
          status?.trader?.openPositions?.some((p) => Number(p.qty) > 0) &&
            matched?.status === "filled",
        ),
      }),
    );
  }, [status, stream.scanning, stream.marketOpen, stream.status]);

  if (!view) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-3 text-sm text-[var(--muted)]">
        Loading order pipeline…
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-sm shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">
          Paper order pipeline
        </h3>
        <AutoTradeInfoTip text="Shows where Auto Trading stopped for the latest setup. Advanced Monitoring finds setups; this engine submits Alpaca paper orders when all gates pass — no manual approve click." />
      </div>

      <p className="text-base font-semibold text-zinc-50">{view.headline}</p>
      <p className="text-sm text-zinc-300">{view.detail}</p>
      {view.stopReason ? (
        <p className="rounded-[var(--radius-sm)] border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
          {view.stopReason}
        </p>
      ) : null}

      <ol className="flex flex-wrap gap-1.5">
        {view.stages.map((s) => (
          <li
            key={s.id}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              s.current
                ? "border-amber-400/50 bg-amber-500/15 text-amber-50"
                : s.done
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
                  : "border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Optional refresh helper if parent only has a refresh nonce. */
export function useAutoTradeStatusPoll(refreshKey?: number) {
  const [status, setStatus] = useState<AutoTradeStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchJson<AutoTradeStatus>("/api/auto-trade")
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return status;
}
