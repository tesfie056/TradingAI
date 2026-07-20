"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";

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
    completed: number;
    pendingEntry: number;
    pendingExit: number;
    openProtected: number;
    needsIntervention: number;
  };
  config: {
    maxHoldMinutes: number;
    eodFlattenMinutes: number;
  };
  active: TradeRow[];
  completed: TradeRow[];
  warnings: { level: string; message: string; symbol?: string }[];
};

function stateTone(state: string): string {
  if (state === "COMPLETED") return "text-emerald-300";
  if (state.includes("REJECTED") || state.includes("MANUAL") || state.includes("RECONCILIATION")) {
    return "text-amber-200";
  }
  if (state.includes("EXIT") || state === "POSITION_OPEN") return "text-sky-300";
  return "text-zinc-200";
}

function holdLabel(ms: number | null): string {
  if (ms == null) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function V1LifecyclePanel() {
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
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load lifecycle");
      }
    }
    const startId = window.setTimeout(() => void tick(), 0);
    const intervalId = window.setInterval(() => void tick(), 45_000);
    return () => {
      cancelled = true;
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <Panel title="Version 1 trade lifecycle">
      <p className="mb-3 text-xs text-zinc-500">
        Paper round-trip status · Version 1-managed positions only · legacy
        positions are never auto-closed
      </p>
      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : !data ? (
        <p className="text-sm text-zinc-500">Loading lifecycle…</p>
      ) : (
        <>
          <ul className="mb-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-4">
            <li>
              Active / completed:{" "}
              <strong className="text-zinc-100">{data.counts.active}</strong>
              {" / "}
              <strong className="text-zinc-100">{data.counts.completed}</strong>
            </li>
            <li>
              Pending entry / exit:{" "}
              <strong className="text-sky-300">{data.counts.pendingEntry}</strong>
              {" / "}
              <strong className="text-sky-300">{data.counts.pendingExit}</strong>
            </li>
            <li>
              Protected open:{" "}
              <strong className="text-emerald-300">
                {data.counts.openProtected}
              </strong>
            </li>
            <li>
              Needs attention:{" "}
              <strong className="text-amber-200">
                {data.counts.needsIntervention}
              </strong>
            </li>
          </ul>
          <p className="mb-3 text-xs text-zinc-500">
            Max hold {data.config.maxHoldMinutes}m · EOD flatten starts{" "}
            {data.config.eodFlattenMinutes}m before close
          </p>

          {data.warnings.length > 0 ? (
            <ul className="mb-3 space-y-1 text-sm text-amber-200">
              {data.warnings.slice(0, 6).map((w, i) => (
                <li key={`${w.message}-${i}`}>
                  {w.symbol ? `${w.symbol}: ` : ""}
                  {w.message}
                </li>
              ))}
            </ul>
          ) : null}

          {data.active.length === 0 && data.completed.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No Version 1 lifecycle trades yet. Trades appear here after a
              gated paper bracket entry (execution and Auto Trading must be on).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1.5 pr-3">Symbol</th>
                    <th className="py-1.5 pr-3">State</th>
                    <th className="py-1.5 pr-3">Qty</th>
                    <th className="py-1.5 pr-3">Entry</th>
                    <th className="py-1.5 pr-3">SL / TP</th>
                    <th className="py-1.5 pr-3">Protection</th>
                    <th className="py-1.5 pr-3">Hold</th>
                    <th className="py-1.5">Exit / P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.active, ...data.completed.slice(-5)].map((row) => (
                    <tr
                      key={row.tradeId}
                      className="border-t border-zinc-800 align-top"
                    >
                      <td className="py-2 pr-3 font-medium text-zinc-100">
                        {row.symbol}
                        <div className="text-xs text-zinc-600">
                          {row.strategyVersion}
                        </div>
                      </td>
                      <td
                        className={`py-2 pr-3 font-semibold ${stateTone(row.lifecycleState)}`}
                      >
                        {row.lifecycleState.replaceAll("_", " ")}
                      </td>
                      <td className="py-2 pr-3 text-zinc-300">
                        {row.filledEntryQty || row.requestedQty}
                        {row.remainingQty > 0 &&
                        row.remainingQty !== row.filledEntryQty
                          ? ` · rem ${row.remainingQty}`
                          : ""}
                      </td>
                      <td className="py-2 pr-3 text-zinc-300">
                        {row.actualAvgEntry != null
                          ? `$${row.actualAvgEntry.toFixed(2)}`
                          : row.plannedEntry != null
                            ? `~$${row.plannedEntry.toFixed(2)}`
                            : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-zinc-400">
                        {row.stopLoss != null ? `$${row.stopLoss.toFixed(2)}` : "—"}
                        {" / "}
                        {row.takeProfit != null
                          ? `$${row.takeProfit.toFixed(2)}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-zinc-300">
                        {row.protectionStatus}
                      </td>
                      <td className="py-2 pr-3 text-zinc-400">
                        {holdLabel(row.holdingDurationMs)}
                        <div className="text-xs text-zinc-600">
                          {formatTime(row.lastBrokerUpdateAt ?? row.updatedAt)}
                        </div>
                      </td>
                      <td className="py-2 text-zinc-400">
                        {row.exitReason
                          ? row.exitReason.replaceAll("_", " ")
                          : row.exitStatus ?? "—"}
                        {row.realizedNetPnL != null
                          ? ` · $${row.realizedNetPnL.toFixed(2)}`
                          : ""}
                        {row.criticalWarnings[0] ? (
                          <div className="mt-1 text-xs text-amber-300">
                            {row.criticalWarnings[0]}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
