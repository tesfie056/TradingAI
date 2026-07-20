"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ActionBadge, SentimentBadge } from "@/components/ui/badges";
import { AdvancedDetails } from "@/components/ui/AdvancedDetails";
import { BlockReasonList } from "@/components/ui/BlockReasonList";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { InfoTip } from "@/components/ui/InfoTip";
import { ScrollTable } from "@/components/ui/ScrollTable";
import { PaperOrdersTable } from "@/components/trades/PaperOrdersTable";
import { fetchJson } from "@/lib/client/fetch-json";
import { loadAiCommandHistory, type StoredAiCommand } from "@/lib/client/ui-settings";
import { formatTime } from "@/lib/format";
import type {
  DecisionPayload,
  PerformancePayload,
  TradeRow,
} from "@/lib/dashboard-types";
import type { DecisionHistoryEntry } from "@/lib/alpaca/types";
import type { DecisionPerformanceEntry } from "@/lib/performance/types";
import type { MonitorLogEntry } from "@/lib/monitor/types";

type LogBundle = {
  decisions: DecisionHistoryEntry[];
  performance: DecisionPerformanceEntry[];
  trades: TradeRow[];
  monitorLogs: MonitorLogEntry[];
  aiProvider: string;
  newsProvider: string;
  orderExecutionEnabled: boolean;
};

/** User-facing activity filter (maps onto existing data kinds). */
type ActivityFilter = "all" | "trades" | "safety" | "system" | "errors";

export function LogsView() {
  const [data, setData] = useState<LogBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [symbol, setSymbol] = useState("ALL");
  const [blockFilter, setBlockFilter] = useState("ALL");
  const [filter, setFilter] = useState<ActivityFilter>("trades");
  const [aiHistory, setAiHistory] = useState<StoredAiCommand[]>(() =>
    typeof window === "undefined" ? [] : loadAiCommandHistory(),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [history, performance, trades, decision, monitor] =
          await Promise.all([
            fetchJson<{ history: DecisionHistoryEntry[] }>("/api/ai/history"),
            fetchJson<PerformancePayload>("/api/performance"),
            fetchJson<{
              trades: TradeRow[];
              orderExecutionEnabled?: boolean;
            }>("/api/trades"),
            fetchJson<DecisionPayload>("/api/ai/decision").catch(() => null),
            fetchJson<{ logs?: MonitorLogEntry[] }>("/api/monitor/logs").catch(
              () => null,
            ),
          ]);
        if (cancelled) return;
        setData({
          decisions: history.history ?? [],
          performance: performance.history ?? [],
          trades: trades.trades ?? [],
          monitorLogs: monitor?.logs ?? [],
          aiProvider:
            decision?.news?.aiStatus?.activeProvider ??
            performance.history[0]?.aiProvider ??
            "—",
          newsProvider: decision?.news?.provider ?? "—",
          orderExecutionEnabled: trades.orderExecutionEnabled ?? false,
        });
        setAiHistory(loadAiCommandHistory());
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

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const d of data?.decisions ?? []) set.add(d.symbol);
    for (const t of data?.trades ?? []) set.add(t.symbol);
    for (const a of aiHistory) a.relatedSymbols.forEach((s) => set.add(s));
    for (const log of data?.monitorLogs ?? []) {
      if (typeof log.meta?.symbol === "string") set.add(log.meta.symbol);
    }
    return ["ALL", ...Array.from(set).sort()];
  }, [data, aiHistory]);

  const decisionRows = useMemo(() => {
    const rows = data?.performance.length
      ? data.performance
      : data?.decisions ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((h) => {
      const row = h as DecisionPerformanceEntry & DecisionHistoryEntry;
      if (symbol !== "ALL" && row.symbol !== symbol) return false;
      if (q) {
        const hay = [
          row.symbol,
          row.action,
          ...(row.reasons ?? []),
          ...(row.riskWarnings ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (blockFilter !== "ALL") {
        const blob = [...(row.reasons ?? []), ...(row.riskWarnings ?? [])]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(blockFilter.toLowerCase())) return false;
      }
      return true;
    });
  }, [data, query, symbol, blockFilter]);

  const blocked = useMemo(() => {
    return (data?.performance ?? []).filter((p) => {
      if (symbol !== "ALL" && p.symbol !== symbol) return false;
      const reasons = [...p.riskWarnings, ...p.reasons];
      const isBlocked =
        p.action === "HOLD" ||
        reasons.some((r) =>
          /block|closed|stale|spread|risk|execution|hold/i.test(r),
        );
      if (!isBlocked) return false;
      if (blockFilter !== "ALL") {
        return reasons.some((r) =>
          r.toLowerCase().includes(blockFilter.toLowerCase()),
        );
      }
      if (query.trim()) {
        const hay = [p.symbol, ...reasons].join(" ").toLowerCase();
        if (!hay.includes(query.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [data, symbol, blockFilter, query]);

  const trades = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.trades ?? []).filter((t) => {
      if (symbol !== "ALL" && t.symbol !== symbol) return false;
      if (!q) return true;
      return `${t.symbol} ${t.side} ${t.status}`.toLowerCase().includes(q);
    });
  }, [data, symbol, query]);

  const aiFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return aiHistory.filter((h) => {
      if (symbol !== "ALL" && !h.relatedSymbols.includes(symbol)) return false;
      if (!q) return true;
      return `${h.instruction} ${h.answer} ${h.relatedSymbols.join(" ")}`
        .toLowerCase()
        .includes(q);
    });
  }, [aiHistory, symbol, query]);

  const monitorFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.monitorLogs ?? []).filter((log) => {
      if (symbol !== "ALL") {
        const metaSym =
          typeof log.meta?.symbol === "string" ? log.meta.symbol : null;
        if (metaSym !== symbol) return false;
      }
      if (!q) return true;
      return `${log.event} ${log.message} ${log.level}`
        .toLowerCase()
        .includes(q);
    });
  }, [data, symbol, query]);

  const errorLogs = useMemo(() => {
    return monitorFiltered.filter(
      (log) => log.level === "error" || log.level === "warn",
    );
  }, [monitorFiltered]);

  const showTrades = filter === "all" || filter === "trades";
  const showSafety =
    filter === "all" || filter === "safety" || filter === "errors";
  const showDecisions = filter === "all" || filter === "trades";
  /** Technical logs stay available (collapsed) on every filter mode. */
  const techLogs = filter === "errors" ? errorLogs : monitorFiltered;
  const showAiHistory = filter === "all" || filter === "system";

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading activity…</p>;
  }
  if (error) {
    return (
      <div className="border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
        {error}
      </div>
    );
  }

  const selectClass =
    "border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5 text-xs";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Activity"
        description="Search and filter meaningful desk events."
        actions={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)]"
          >
            Refresh
          </button>
        }
      />

      <Panel title="Activity tools">
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search activity…"
            className={`${selectClass} min-w-[10rem] flex-1`}
          />
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className={selectClass}
          >
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? "All symbols" : s}
              </option>
            ))}
          </select>
          <select
            value={blockFilter}
            onChange={(e) => setBlockFilter(e.target.value)}
            className={selectClass}
          >
            <option value="ALL">Any block reason</option>
            <option value="market closed">Market closed</option>
            <option value="execution">Order execution</option>
            <option value="high risk">High risk</option>
            <option value="stale">Stale quote</option>
            <option value="spread">Wide spread</option>
            <option value="hold">HOLD</option>
          </select>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as ActivityFilter)}
            className={selectClass}
            aria-label="Activity type"
          >
            <option value="all">All</option>
            <option value="trades">Trades</option>
            <option value="safety">Safety</option>
            <option value="system">System</option>
            <option value="errors">Errors</option>
          </select>
        </div>
      </Panel>

      {showTrades && (
        <Panel title="Paper order preview / submission history">
          {trades.length > 0 ? (
            <PaperOrdersTable trades={trades} timeColumn="submitted" />
          ) : (
            <EmptyState title="No paper trade approvals yet">
              <p>Manual paper submits will show here after confirmation.</p>
            </EmptyState>
          )}
        </Panel>
      )}

      {showDecisions && (
        <Panel title="Decision history">
          {decisionRows.length === 0 ? (
            <EmptyState title="No matching decisions">
              <p>Try clearing search or symbol filters.</p>
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
                  {decisionRows.slice(0, 50).map((h, i) => {
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
      )}

      {showSafety && (
        <ExpandableSection
          title="Blocked trade reasons"
          expandLabel="View blocked trades"
          collapseLabel="Hide blocked trades"
          summary={
            filter === "errors"
              ? `${blocked.length} safety / block entries (errors filter).`
              : `${blocked.length} safety / block entries.`
          }
        >
          {blocked.length > 0 ? (
            <ul className="space-y-3 text-sm">
              {blocked.slice(0, 30).map((b, i) => {
                const reasons = [...b.riskWarnings, ...b.reasons].filter((r) =>
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
                        layout="inline"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No blocked-trade log entries">
              <p>No matching blocked reasons for the current filters.</p>
            </EmptyState>
          )}
        </ExpandableSection>
      )}

      <ExpandableSection
        title="Technical Logs"
        expandLabel="View technical logs"
        collapseLabel="Hide technical logs"
        tip={
          <InfoTip text="Raw monitor scan events for troubleshooting. Collapsed by default." />
        }
        summary={
          filter === "errors"
            ? `${techLogs.length} warn/error monitor events.`
            : "Developer-oriented monitor scan events."
        }
      >
        {techLogs.length === 0 ? (
          <EmptyState title="No monitor log entries">
            <p>
              {filter === "errors"
                ? "No warn/error monitor events for the current filters."
                : "Start a monitor scan to populate this section."}
            </p>
          </EmptyState>
        ) : (
          <ul className="space-y-3 text-sm">
            {techLogs.slice(0, 50).map((log) => (
              <li
                key={log.id}
                className="border-b border-[var(--border)]/40 pb-3"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold capitalize">{log.event}</span>
                  <span
                    className={`text-[10px] uppercase ${
                      log.level === "error"
                        ? "text-rose-200"
                        : log.level === "warn"
                          ? "text-amber-200"
                          : "text-[var(--muted)]"
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {formatTime(log.timestamp)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--foreground)]/85">
                  {log.message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ExpandableSection>

      {showAiHistory && (
        <AdvancedDetails
          title="AI command history"
          summary="Local browser AI assistant commands. Collapsed by default."
        >
          {aiFiltered.length === 0 ? (
            <EmptyState title="No AI commands logged">
              <p>
                Use Ask AI on the Assistant page. Commands are stored in this
                browser only.
              </p>
            </EmptyState>
          ) : (
            <ul className="space-y-3 text-sm">
              {aiFiltered.slice(0, 30).map((h) => (
                <li
                  key={h.id}
                  className="border-b border-[var(--border)]/40 pb-3"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-amber-100/90">
                      {h.instruction}
                    </span>
                    <span className="text-[10px] uppercase text-[var(--muted)]">
                      {h.provider} · {h.suggestedAction}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {formatTime(h.timestamp)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--foreground)]/85">
                    {h.answer}
                  </p>
                  {h.relatedSymbols.length > 0 && (
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      Symbols: {h.relatedSymbols.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </AdvancedDetails>
      )}
    </div>
  );
}
