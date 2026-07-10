"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { ActionBadge, SentimentBadge } from "@/components/ui/badges";
import { BlockReasonList } from "@/components/ui/BlockReasonList";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaperOnlyBanner } from "@/components/ui/PaperOnlyBanner";
import { ScrollTable } from "@/components/ui/ScrollTable";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";
import type {
  DecisionPayload,
  PerformancePayload,
  TradeRow,
} from "@/lib/dashboard-types";
import type { DecisionHistoryEntry } from "@/lib/alpaca/types";
import type { DecisionPerformanceEntry } from "@/lib/performance/types";

type LogBundle = {
  decisions: DecisionHistoryEntry[];
  performance: DecisionPerformanceEntry[];
  trades: TradeRow[];
  aiProvider: string;
  newsProvider: string;
};

export function LogsView() {
  const [data, setData] = useState<LogBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [history, performance, trades, decision] = await Promise.all([
          fetchJson<{ history: DecisionHistoryEntry[] }>("/api/ai/history"),
          fetchJson<PerformancePayload>("/api/performance"),
          fetchJson<{ trades: TradeRow[] }>("/api/trades"),
          fetchJson<DecisionPayload>("/api/ai/decision").catch(() => null),
        ]);
        if (cancelled) return;
        setData({
          decisions: history.history ?? [],
          performance: performance.history ?? [],
          trades: trades.trades ?? [],
          aiProvider:
            decision?.news?.aiStatus?.activeProvider ??
            performance.history[0]?.aiProvider ??
            "—",
          newsProvider: decision?.news?.provider ?? "—",
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load logs");
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
    return <p className="text-sm text-[var(--muted)]">Loading logs…</p>;
  }
  if (error) {
    return (
      <div className="border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
        {error}
      </div>
    );
  }

  const rows = data?.performance.length
    ? data.performance
    : data?.decisions ?? [];
  const blocked = (data?.performance ?? []).filter(
    (p) =>
      p.action === "HOLD" &&
      (p.riskWarnings.some((w) => /block|closed|stale|spread|risk/i.test(w)) ||
        p.reasons.some((r) => /block|closed|stale|spread|risk/i.test(r))),
  );
  const empty =
    rows.length === 0 &&
    (data?.trades.length ?? 0) === 0 &&
    blocked.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
          Logs
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Decision history, paper trade approvals, and block reasons. No secrets.
        </p>
      </div>

      <PaperOnlyBanner
        detail={`AI ${data?.aiProvider ?? "—"} · News ${data?.newsProvider ?? "—"}`}
      />

      {empty ? (
        <EmptyState title="No logs yet">
          <p>
            Refresh the Control Room to generate decisions. Paper trade
            approvals and blocked reasons will appear here afterward.
          </p>
        </EmptyState>
      ) : null}

      <Panel title="Decision history">
        {rows.length === 0 ? (
          <EmptyState title="No logs yet">
            <p>No decision history stored yet.</p>
          </EmptyState>
        ) : (
          <ScrollTable minWidthClass="min-w-[36rem] sm:min-w-[48rem]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">Conf.</th>
                  <th className="py-2 pr-3 font-medium">AI / News</th>
                  <th className="py-2 font-medium">Reasons</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((h, i) => {
                  const row = h as DecisionPerformanceEntry &
                    DecisionHistoryEntry;
                  return (
                    <tr
                      key={`${row.symbol}-${row.timestamp}-${i}`}
                      className="border-b border-[var(--border)]/50 align-top"
                    >
                      <td className="py-2 pr-3 text-[var(--muted)] whitespace-nowrap">
                        {formatTime(row.timestamp)}
                      </td>
                      <td className="py-2 pr-3 font-semibold">{row.symbol}</td>
                      <td className="py-2 pr-3">
                        <ActionBadge action={row.action} />
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {(row.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <div>
                          {"aiProvider" in row && row.aiProvider
                            ? row.aiProvider
                            : data?.aiProvider}
                        </div>
                        <SentimentBadge
                          sentiment={
                            "newsSentiment" in row ? row.newsSentiment : null
                          }
                        />
                      </td>
                      <td className="py-2 text-xs text-[var(--foreground)]/80">
                        {row.reasons.slice(0, 2).join(" · ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Panel>

      <Panel title="Trade approval history (paper orders)">
        {(data?.trades.length ?? 0) > 0 ? (
          <ScrollTable minWidthClass="min-w-[28rem] sm:min-w-[36rem]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase">
                  <th className="py-2 pr-3 font-medium">Submitted</th>
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">Side</th>
                  <th className="py-2 pr-3 font-medium">Qty</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data!.trades.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--border)]/50"
                  >
                    <td className="py-2 pr-3 text-[var(--muted)]">
                      {formatTime(t.submittedAt)}
                    </td>
                    <td className="py-2 pr-3 font-semibold">{t.symbol}</td>
                    <td className="py-2 pr-3">
                      <ActionBadge action={t.side} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {t.qty ?? t.filledQty ?? "—"}
                    </td>
                    <td className="py-2 text-[var(--muted)]">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        ) : (
          <EmptyState title="No paper trade approvals yet">
            <p>Manual paper submits will show here after confirmation.</p>
          </EmptyState>
        )}
      </Panel>

      <Panel title="Blocked trade reasons">
        {blocked.length > 0 ? (
          <ul className="space-y-3 text-sm">
            {blocked.slice(0, 30).map((b, i) => {
              const reasons = [
                ...b.riskWarnings,
                ...b.reasons,
              ].filter((r) =>
                /block|closed|stale|spread|risk|hold|execution/i.test(r),
              );
              return (
                <li
                  key={`${b.id}-${i}`}
                  className="border-b border-[var(--border)]/40 pb-3"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{b.symbol}</span>
                    <span className="text-[var(--muted)] text-xs">
                      {formatTime(b.timestamp)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <BlockReasonList
                      reasons={
                        reasons.length > 0
                          ? reasons
                          : ["HOLD — not tradeable"]
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No blocked-trade log entries yet">
            <p>
              Clear labels such as market closed, order execution off, high
              risk, stale quote, and wide spread will appear here when
              decisions are blocked.
            </p>
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}
