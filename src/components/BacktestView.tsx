"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ActionBadge } from "@/components/ui/badges";
import { AdvancedDetails } from "@/components/ui/AdvancedDetails";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { InfoTip } from "@/components/ui/InfoTip";
import { SummaryMetric } from "@/components/ui/SummaryMetric";
import { ScrollTable } from "@/components/ui/ScrollTable";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";
import type { BacktestResult } from "@/lib/performance/types";
import type { AppSettingsView } from "@/lib/settings/view";

export function BacktestView() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState("AAPL");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await fetchJson<AppSettingsView>("/api/settings");
        setSymbols(settings.watchlist);
        if (settings.watchlist[0]) setSymbol(settings.watchlist[0]);
      } catch {
        setSymbols([
          "F",
          "T",
          "VZ",
          "PFE",
          "WBD",
          "NOK",
          "AAL",
          "CMCSA",
          "HPE",
          "RIG",
          "HBAN",
          "CCL",
          "ITUB",
          "VALE",
          "ERIC",
          "HPQ",
        ]);
      }
    })();
  }, []);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ symbol });
      if (start) params.set("start", start);
      if (end) params.set("end", end);
      params.set("lookbackBars", start || end ? "200" : "120");
      const res = await fetchJson<BacktestResult>(
        `/api/backtest?${params.toString()}`,
      );
      setResult(res);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setBusy(false);
    }
  }

  const s = result?.summary;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Backtest"
        description="Run a historical paper simulation for research."
      />

      <Panel
        title="Run Backtest"
        action={
          <InfoTip text="Historical simulation only. Never places orders. Backtest and paper results do not guarantee future profit." />
        }
      >
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex min-w-[8rem] flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-[var(--muted)] uppercase">Stocks</span>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
            >
              {symbols.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[9rem] flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-[var(--muted)] uppercase">
              Start date
            </span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
            />
          </label>
          <label className="flex min-w-[9rem] flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-[var(--muted)] uppercase">
              End date
            </span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1.5"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className="border border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-amber-50 disabled:opacity-50"
          >
            {busy ? "Running…" : "Run Backtest"}
          </button>
        </div>
      </Panel>

      {error && (
        <div className="border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      {!result && !error && !busy && (
        <EmptyState title="No backtest results yet">
          <p>
            Choose a U.S. stock symbol (and optional date range), then click Run
            Backtest. Results are paper simulation only.
          </p>
        </EmptyState>
      )}

      {result && s && (
        <>
          <dl className="grid gap-3 grid-cols-2 lg:grid-cols-4 text-sm">
            <SummaryMetric
              label="Est. P/L"
              value={
                s.estimatedPnlPctTotal == null
                  ? "—"
                  : `${(s.estimatedPnlPctTotal * 100).toFixed(2)}%`
              }
            />
            <SummaryMetric label="# Trades" value={String(s.tradeCount)} />
            <SummaryMetric
              label="Win rate"
              value={
                s.winRate == null ? "—" : `${(s.winRate * 100).toFixed(0)}%`
              }
            />
            <SummaryMetric
              label="Max drawdown"
              value={
                s.maxDrawdownPct == null
                  ? "—"
                  : `${(s.maxDrawdownPct * 100).toFixed(2)}%`
              }
            />
          </dl>

          <ExpandableSection
            title="Trade list"
            expandLabel="View trade list"
            collapseLabel="Hide trade list"
            summary={`Simulated decisions for ${result.symbols.join(", ")} · ${result.barsUsed} bars`}
          >
            {result.decisions.length === 0 ? (
              <EmptyState title="No backtest results yet">
                <p>
                  Not enough historical bars in this window. Try a wider date
                  range or leave dates blank.
                </p>
              </EmptyState>
            ) : (
              <ScrollTable minWidthClass="min-w-[32rem] sm:min-w-[40rem]">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)]">
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Action</th>
                      <th className="py-2 pr-3 font-medium">Price</th>
                      <th className="py-2 pr-3 font-medium">Confidence</th>
                      <th className="py-2 font-medium">Est. P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.decisions.slice(0, 50).map((d, i) => (
                      <tr
                        key={`${d.symbol}-${d.timestamp}-${i}`}
                        className="border-b border-[var(--border)]/50"
                      >
                        <td className="whitespace-nowrap py-2 pr-3 text-[var(--muted)]">
                          {formatTime(d.timestamp)}
                        </td>
                        <td className="py-2 pr-3">
                          <ActionBadge action={d.action} />
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {d.price.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {(d.confidence * 100).toFixed(0)}%
                        </td>
                        <td className="py-2 tabular-nums">
                          {d.estimatedPnlPct == null
                            ? "—"
                            : `${(d.estimatedPnlPct * 100).toFixed(2)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            )}
          </ExpandableSection>

          <AdvancedDetails
            title="Technical details"
            summary="Bars used, action mix, accuracy, and window metadata."
          >
            <p className="text-sm text-[var(--muted)]">
              Bars used {result.barsUsed} · Buy {s.buy} · Sell {s.sell} · Hold{" "}
              {s.hold}
              {result.startDate || result.endDate
                ? ` · window ${result.startDate ?? "…"} → ${result.endDate ?? "…"}`
                : ""}
            </p>
            <p className="mt-2 text-sm text-zinc-200">
              Accuracy:{" "}
              {s.accuracy == null ? "—" : `${(s.accuracy * 100).toFixed(0)}%`}
            </p>
          </AdvancedDetails>
        </>
      )}
    </div>
  );
}
