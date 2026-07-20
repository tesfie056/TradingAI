"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";
import { protectionStatusLabel } from "@/lib/auto-trade/operator-blockers";

type TradeRow = {
  tradeId: string;
  symbol: string;
  lifecycleState: string;
  strategyVersion: string;
  requestedQty: number;
  filledEntryQty: number;
  remainingQty: number;
  actualAvgEntry: number | null;
  plannedEntry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  protectionStatus: string;
  exitReason: string | null;
  exitStatus: string | null;
  realizedNetPnL: number | null;
  holdingDurationMs: number | null;
  updatedAt: string;
  lastBrokerUpdateAt: string | null;
  criticalWarnings: string[];
};

type Payload = {
  ok?: boolean;
  counts: {
    active: number;
    needsIntervention: number;
  };
  config: {
    maxHoldMinutes: number;
  };
  active: TradeRow[];
};

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function holdLabel(ms: number | null): string {
  if (ms == null) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function protectionTone(label: string): string {
  if (label === "Protected") return "text-emerald-300";
  if (label === "Protection Pending") return "text-sky-300";
  if (label === "Missing Protection" || label === "Manual Attention Required") {
    return "text-amber-200";
  }
  return "text-zinc-200";
}

export function V1ManagedTradeCard({
  onNeedsIntervention,
}: {
  onNeedsIntervention?: (needs: boolean) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetchJson<Payload>("/api/auto-trade/v1-lifecycle");
        if (cancelled) return;
        setData(res);
        setError(null);
        onNeedsIntervention?.(
          (res.counts?.needsIntervention ?? 0) > 0 ||
            (res.active ?? []).some((t) =>
              t.lifecycleState.includes("MANUAL") ||
              t.lifecycleState.includes("RECONCILIATION") ||
              t.criticalWarnings.length > 0,
            ),
        );
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load managed trade");
      }
    }
    const startId = window.setTimeout(() => void tick(), 0);
    const intervalId = window.setInterval(() => void tick(), 45_000);
    return () => {
      cancelled = true;
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, [onNeedsIntervention]);

  const trade = data?.active?.[0] ?? null;
  const maxHold = data?.config.maxHoldMinutes ?? 90;

  return (
    <Panel
      title="Current managed trade"
      action={
        <span className="text-xs text-[var(--muted)]">
          Version 1 managed
          <AutoTradeInfoTip text="Only Version 1 long positions are shown here. Legacy and external positions appear separately." />
        </span>
      }
    >
      {error ? (
        <div className="text-sm text-red-300">
          <p>{error}</p>
          <button
            type="button"
            className="ui-btn mt-2 border border-[var(--border)] text-sm"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <p className="text-sm text-[var(--muted)]" role="status">
          Loading managed trade…
        </p>
      ) : !trade ? (
        <div>
          <p className="text-base font-medium text-zinc-100">
            No active Version 1 trade
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            The system is waiting for a qualified setup.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-2xl font-semibold tracking-tight text-zinc-50">
              {trade.symbol}
            </p>
            <p className="text-sm text-sky-200">{trade.lifecycleState.replace(/_/g, " ")}</p>
          </div>

          {(trade.lifecycleState.includes("PARTIAL") ||
            trade.criticalWarnings.length > 0 ||
            trade.lifecycleState.includes("MANUAL")) && (
            <ul className="space-y-1 rounded-[var(--radius-sm)] border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              {trade.lifecycleState.includes("ENTRY_PARTIALLY") ? (
                <li>Partial entry fill — remaining size may still be working.</li>
              ) : null}
              {trade.lifecycleState.includes("EXIT_PARTIALLY") ? (
                <li>Partial exit fill — position may still be open.</li>
              ) : null}
              {trade.lifecycleState.includes("MANUAL") ||
              trade.lifecycleState.includes("RECONCILIATION") ? (
                <li>Manual intervention warning — review this trade before continuing.</li>
              ) : null}
              {trade.criticalWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <dl className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-[var(--muted)]">Ownership</dt>
              <dd className="font-medium text-zinc-100">Version 1 managed</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Quantity</dt>
              <dd className="font-medium text-zinc-100">
                {trade.remainingQty || trade.filledEntryQty || trade.requestedQty}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Entry price</dt>
              <dd className="font-medium text-zinc-100">
                {fmtUsd(trade.actualAvgEntry ?? trade.plannedEntry)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Stop-loss
                <AutoTradeInfoTip text="Planned protective stop for this Version 1 long." />
              </dt>
              <dd className="font-medium text-zinc-100">{fmtUsd(trade.stopLoss)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Take-profit
                <AutoTradeInfoTip text="Planned profit target for this Version 1 long." />
              </dt>
              <dd className="font-medium text-zinc-100">{fmtUsd(trade.takeProfit)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Protection status
                <AutoTradeInfoTip text="Whether stop-loss and take-profit protection is active at the broker." />
              </dt>
              <dd
                className={`font-medium ${protectionTone(protectionStatusLabel(trade.protectionStatus))}`}
              >
                {protectionStatusLabel(trade.protectionStatus)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Holding duration
                <AutoTradeInfoTip text="How long this Version 1 position has been held." />
              </dt>
              <dd className="font-medium text-zinc-100">
                {holdLabel(trade.holdingDurationMs)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Maximum holding time
                <AutoTradeInfoTip text="Version 1 exits managed trades that exceed this holding window." />
              </dt>
              <dd className="font-medium text-zinc-100">{maxHold} minutes</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Exit status</dt>
              <dd className="font-medium text-zinc-100">
                {trade.exitStatus?.replace(/_/g, " ") ??
                  trade.exitReason?.replace(/_/g, " ") ??
                  "Open"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Last broker update</dt>
              <dd className="font-medium text-zinc-100">
                {formatTime(trade.lastBrokerUpdateAt ?? trade.updatedAt)}
              </dd>
            </div>
            {trade.exitReason ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-[var(--muted)]">Current exit trigger</dt>
                <dd className="font-medium text-zinc-100">
                  {trade.exitReason.replace(/_/g, " ")}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      )}
    </Panel>
  );
}
