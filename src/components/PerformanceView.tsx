"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { InfoTip } from "@/components/ui/InfoTip";
import { ActionBadge } from "@/components/ui/badges";
import { EmptyState } from "@/components/ui/EmptyState";
import { SummaryMetric } from "@/components/ui/SummaryMetric";
import { ScrollTable } from "@/components/ui/ScrollTable";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";
import type { PerformancePayload } from "@/lib/dashboard-types";
import type { AccuracyBucket } from "@/lib/performance/types";

function BucketTable({ title, rows }: { title: string; rows: AccuracyBucket[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      <ScrollTable minWidthClass="min-w-[18rem]">
        <table className="w-full text-left text-base">
          <thead>
            <tr className="border-b border-[var(--border)] text-sm text-[var(--muted)]">
              <th className="py-2 pr-2 font-medium">Group</th>
              <th className="py-2 pr-2 font-medium">Total</th>
              <th className="py-2 pr-2 font-medium">Accuracy</th>
              <th className="py-2 font-medium">Est. P/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-[var(--muted)]">
                  No evaluated groups yet
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
    </div>
  );
}

const PAGE_SIZE = 10;

export function PerformanceView() {
  const [data, setData] = useState<PerformancePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState<"ALL" | "BUY" | "SELL" | "HOLD">(
    "ALL",
  );

  async function loadPerformance(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetchJson<PerformancePayload>("/api/performance");
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadPerformance(false);
  }, []);

  const history = data?.history ?? [];
  const summary = data?.summary;
  const evaluated = summary?.evaluated ?? 0;
  const total = summary?.totalDecisions ?? 0;

  const completed = useMemo(
    () =>
      history.filter(
        (h) =>
          h.overallLabel === "correct" ||
          h.overallLabel === "incorrect" ||
          h.overallLabel === "neutral",
      ),
    [history],
  );

  const wins = completed.filter((h) => h.overallLabel === "correct").length;
  const winRate =
    completed.length > 0 ? wins / completed.length : evaluated > 0
      ? history.filter((h) => h.overallLabel === "correct").length /
        Math.max(1, evaluated)
      : null;

  const avgPnl = useMemo(() => {
    const pnls = completed
      .map(
        (h) =>
          h.outcomes.h1.estimatedPnlPct ??
          h.outcomes.m15.estimatedPnlPct ??
          h.outcomes.nextClose.estimatedPnlPct,
      )
      .filter((n): n is number => n != null && Number.isFinite(n));
    if (pnls.length === 0) return null;
    return pnls.reduce((a, b) => a + b, 0) / pnls.length;
  }, [completed]);

  const totalPnl = useMemo(() => {
    const pnls = completed
      .map(
        (h) =>
          h.outcomes.h1.estimatedPnlPct ??
          h.outcomes.m15.estimatedPnlPct ??
          h.outcomes.nextClose.estimatedPnlPct,
      )
      .filter((n): n is number => n != null && Number.isFinite(n));
    if (pnls.length === 0) return null;
    return pnls.reduce((a, b) => a + b, 0);
  }, [completed]);

  const analyticsRows = useMemo(() => {
    return history.filter(
      (h) => actionFilter === "ALL" || h.action === actionFilter,
    );
  }, [history, actionFilter]);

  const pageCount = Math.max(1, Math.ceil(analyticsRows.length / PAGE_SIZE));
  const pageRows = analyticsRows.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE,
  );

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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Performance"
        description="How has paper trading performed?"
        actions={
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadPerformance(true)}
            className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric
          label="Total paper P/L"
          tip="Sum of estimated P/L on completed scored results"
          value={
            totalPnl == null ? "—" : `${(totalPnl * 100).toFixed(2)}%`
          }
          valueClass={
            totalPnl == null
              ? "text-zinc-100"
              : totalPnl > 0
                ? "text-emerald-300"
                : totalPnl < 0
                  ? "text-red-300"
                  : "text-zinc-100"
          }
        />
        <SummaryMetric
          label="Completed trades"
          tip="Scored decisions with an outcome"
          value={String(completed.length)}
        />
        <SummaryMetric
          label="Win rate"
          tip="Share of completed results labeled as wins"
          value={winRate == null ? "—" : `${(winRate * 100).toFixed(0)}%`}
        />
        <SummaryMetric
          label="Average trade"
          tip="Average estimated P/L across completed results"
          value={
            avgPnl == null ? "—" : `${(avgPnl * 100).toFixed(2)}%`
          }
        />
      </dl>

      {completed.length === 0 ? (
        <EmptyState title="No completed trade results yet">
          <p>
            Performance statistics will appear after paper trades close and later
            prices are available.
          </p>
        </EmptyState>
      ) : (
        <Panel title="Recent completed trades">
          <ScrollTable minWidthClass="min-w-[32rem]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)]">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">Outcome</th>
                  <th className="py-2 font-medium">Est. P/L</th>
                </tr>
              </thead>
              <tbody>
                {completed.slice(0, 12).map((h) => {
                  const pnl =
                    h.outcomes.h1.estimatedPnlPct ??
                    h.outcomes.m15.estimatedPnlPct ??
                    h.outcomes.nextClose.estimatedPnlPct;
                  return (
                    <tr
                      key={h.id}
                      className="border-b border-[var(--border)]/50"
                    >
                      <td className="whitespace-nowrap py-2 pr-3 text-[var(--muted)]">
                        {formatTime(h.timestamp)}
                      </td>
                      <td className="py-2 pr-3 font-semibold">{h.symbol}</td>
                      <td className="py-2 pr-3">
                        <ActionBadge action={h.action} />
                      </td>
                      <td className="py-2 pr-3 text-xs capitalize">
                        {h.overallLabel}
                      </td>
                      <td className="py-2 tabular-nums">
                        {pnl == null ? "—" : `${(pnl * 100).toFixed(2)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
        </Panel>
      )}

      <ExpandableSection
        title="Decision analytics"
        tip={
          <InfoTip text="Monitoring activity and scored decision rows. Collapsed by default." />
        }
        summary={
          total > 0
            ? `${total} decisions logged · ${evaluated} evaluated`
            : "No decision monitoring activity yet."
        }
        expandLabel="View decision analytics"
        collapseLabel="Hide decision analytics"
      >
        {total === 0 ? (
          <EmptyState title="No paper decisions yet">
            <p>
              Use Overview or Watchlist to generate paper decisions. Accuracy and
              estimated P/L appear after future prices are available.
            </p>
          </EmptyState>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-[var(--muted)]">
                Filter
                <select
                  value={actionFilter}
                  onChange={(e) => {
                    setActionFilter(
                      e.target.value as "ALL" | "BUY" | "SELL" | "HOLD",
                    );
                    setPage(0);
                  }}
                  className="ml-2 border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1 text-sm text-zinc-100"
                >
                  <option value="ALL">All actions</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                  <option value="HOLD">HOLD</option>
                </select>
              </label>
              <p className="text-xs text-[var(--muted)]">
                {analyticsRows.length} rows · page {page + 1} of {pageCount}
              </p>
            </div>
            <ScrollTable minWidthClass="min-w-[36rem]">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)]">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Symbol</th>
                    <th className="py-2 pr-3 font-medium">Action</th>
                    <th className="py-2 pr-3 font-medium">Confidence</th>
                    <th className="py-2 pr-3 font-medium">Outcome</th>
                    <th className="py-2 font-medium">Est. P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-3 text-[var(--muted)]">
                        No matching decisions
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((h) => {
                      const pnl =
                        h.outcomes.h1.estimatedPnlPct ??
                        h.outcomes.m15.estimatedPnlPct ??
                        h.outcomes.nextClose.estimatedPnlPct;
                      return (
                        <tr
                          key={h.id}
                          className="border-b border-[var(--border)]/50"
                        >
                          <td className="whitespace-nowrap py-2 pr-3 text-[var(--muted)]">
                            {formatTime(h.timestamp)}
                          </td>
                          <td className="py-2 pr-3 font-semibold">{h.symbol}</td>
                          <td className="py-2 pr-3">
                            <ActionBadge action={h.action} />
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {(h.confidence * 100).toFixed(0)}%
                          </td>
                          <td className="py-2 pr-3 text-xs capitalize">
                            {h.overallLabel === "pending"
                              ? "Pending"
                              : h.overallLabel}
                          </td>
                          <td className="py-2 tabular-nums">
                            {pnl == null ? "—" : `${(pnl * 100).toFixed(2)}%`}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </ScrollTable>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="ui-btn border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-40"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="ui-btn border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-40"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </ExpandableSection>

      <ExpandableSection
        title="Advanced statistics"
        tip={
          <InfoTip text="Detailed bucket statistics for research. Collapsed by default." />
        }
        summary="By symbol, action, and confidence groups."
        expandLabel="View advanced statistics"
        collapseLabel="Hide advanced statistics"
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <BucketTable title="By symbol" rows={summary?.bySymbol ?? []} />
          <BucketTable title="By action" rows={summary?.byAction ?? []} />
          <BucketTable
            title="Confidence vs result"
            rows={summary?.confidenceBuckets ?? []}
          />
        </div>
      </ExpandableSection>
    </div>
  );
}
