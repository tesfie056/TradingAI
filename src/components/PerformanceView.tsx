"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { ActionBadge } from "@/components/ui/badges";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaperOnlyBanner } from "@/components/ui/PaperOnlyBanner";
import { SafetyStrip } from "@/components/ui/SafetyStrip";
import { ScrollTable } from "@/components/ui/ScrollTable";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";
import type { PerformancePayload } from "@/lib/dashboard-types";
import type { AccuracyBucket } from "@/lib/performance/types";

function BucketTable({ title, rows }: { title: string; rows: AccuracyBucket[] }) {
  return (
    <Panel title={title}>
      <ScrollTable minWidthClass="min-w-[18rem]">
        <table className="w-full text-left text-base">
          <thead>
            <tr className="border-b border-[var(--border)] text-sm text-[var(--muted)]">
              <th className="py-2 pr-2 font-medium">Key</th>
              <th className="py-2 pr-2 font-medium">Total</th>
              <th className="py-2 pr-2 font-medium">Accuracy</th>
              <th className="py-2 font-medium">Est. P/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-[var(--muted)]">
                  No evaluated buckets yet
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key} className="border-b border-[var(--border)]/50">
                  <td className="py-2 pr-2 font-medium">{r.key}</td>
                  <td className="py-2 pr-2 tabular-nums">{r.total}</td>
                  <td className="py-2 pr-2 tabular-nums">
                    {r.accuracy == null
                      ? "—"
                      : `${(r.accuracy * 100).toFixed(0)}%`}
                  </td>
                  <td className="py-2 tabular-nums">
                    {r.avgEstimatedPnlPct == null
                      ? "—"
                      : `${(r.avgEstimatedPnlPct * 100).toFixed(2)}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollTable>
    </Panel>
  );
}

export function PerformanceView() {
  const [data, setData] = useState<PerformancePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchJson<PerformancePayload>("/api/performance");
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading performance…</p>;
  }
  if (error) {
    return (
      <div className="border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
        {error}
      </div>
    );
  }

  const summary = data?.summary;
  const history = data?.history ?? [];
  const evaluated = summary?.evaluated ?? 0;
  const total = summary?.totalDecisions ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="h1">Performance</h1>
        <p className="mt-2 text-base text-[var(--muted)]">
          Paper estimates only — decisions are scored without placing orders.
        </p>
      </div>

      <SafetyStrip orderExecutionEnabled={false} />

      <PaperOnlyBanner detail="estimated gain/loss is not real P&L" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <Panel>
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Decisions logged
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{total}</div>
        </Panel>
        <Panel>
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Evaluated
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {evaluated}
          </div>
        </Panel>
        <Panel>
          <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Order execution
          </div>
          <div className="mt-1 text-2xl font-semibold text-amber-200">OFF*</div>
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            *Performance tracking never executes orders
          </p>
        </Panel>
      </div>

      {evaluated === 0 && (
        <div className="border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--foreground)]/90">
          <p className="font-semibold text-amber-100">
            Why Evaluated = 0
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
            <li>
              Decisions are pending until future price data is available.
            </li>
            <li>Market closed decisions may remain pending.</li>
            {total === 0 ? (
              <li>
                No decisions logged yet — refresh the Control Room to generate
                and store decisions.
              </li>
            ) : (
              <li>
                {total} decision{total === 1 ? "" : "s"} logged; outcomes will
                fill in after later prices (15m / 1h / next close) are available.
              </li>
            )}
          </ul>
        </div>
      )}

      {total === 0 ? (
        <EmptyState title="No evaluated decisions yet">
          <p>
            Refresh the Control Room to log paper decisions. Accuracy and
            estimated P/L appear after future prices are available.
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <BucketTable title="By symbol" rows={summary?.bySymbol ?? []} />
            <BucketTable title="By action" rows={summary?.byAction ?? []} />
            <BucketTable
              title="Confidence vs result"
              rows={summary?.confidenceBuckets ?? []}
            />
          </div>

          <Panel title="Recent scored decisions">
            {history.length === 0 ? (
              <EmptyState title="No evaluated decisions yet">
                <p>
                  Decisions are pending until future price data is available.
                  Market closed decisions may remain pending.
                </p>
              </EmptyState>
            ) : (
              <ScrollTable minWidthClass="min-w-[36rem] sm:min-w-[44rem]">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase">
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Symbol</th>
                      <th className="py-2 pr-3 font-medium">Action</th>
                      <th className="py-2 pr-3 font-medium">Conf.</th>
                      <th className="py-2 pr-3 font-medium">Outcome</th>
                      <th className="py-2 font-medium">Est. P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice(0, 40).map((h) => {
                      const pnl =
                        h.outcomes.h1.estimatedPnlPct ??
                        h.outcomes.m15.estimatedPnlPct ??
                        h.outcomes.nextClose.estimatedPnlPct;
                      return (
                        <tr
                          key={h.id}
                          className="border-b border-[var(--border)]/50"
                        >
                          <td className="py-2 pr-3 text-[var(--muted)] whitespace-nowrap">
                            {formatTime(h.timestamp)}
                          </td>
                          <td className="py-2 pr-3 font-semibold">
                            {h.symbol}
                          </td>
                          <td className="py-2 pr-3">
                            <ActionBadge action={h.action} />
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {(h.confidence * 100).toFixed(0)}%
                          </td>
                          <td className="py-2 pr-3 text-xs uppercase">
                            {h.overallLabel}
                          </td>
                          <td className="py-2 tabular-nums">
                            {pnl == null
                              ? "—"
                              : `${(pnl * 100).toFixed(2)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollTable>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
