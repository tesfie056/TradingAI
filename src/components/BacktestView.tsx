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
      <div>
        <h1 className="h1">Backtest</h1>
        <p className="mt-2 text-base text-[var(--muted)]">
          Replay stock decision logic on historical 5-minute bars. Never places
          orders.
        </p>
      </div>

      <SafetyStrip orderExecutionEnabled={false} />

      <PaperOnlyBanner detail="simulation never places orders" />

      <Panel title="Run parameters">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex min-w-[8rem] flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-[var(--muted)] uppercase">Symbol</span>
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
            {busy ? "Running…" : "Run backtest"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Date range filters available bars from Alpaca IEX history. Leave blank
          to use the recent lookback window.
        </p>
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
            backtest. Results are paper simulation only.
          </p>
        </EmptyState>
      )}

      {result && s && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 text-sm">
            <Panel>
              <div className="text-xs uppercase text-[var(--muted)]">
                Win rate
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {s.winRate == null ? "—" : `${(s.winRate * 100).toFixed(0)}%`}
              </div>
            </Panel>
            <Panel>
              <div className="text-xs uppercase text-[var(--muted)]">
                Est. P/L
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {s.estimatedPnlPctTotal == null
                  ? "—"
                  : `${(s.estimatedPnlPctTotal * 100).toFixed(2)}%`}
              </div>
            </Panel>
            <Panel>
              <div className="text-xs uppercase text-[var(--muted)]">
                Max drawdown
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {s.maxDrawdownPct == null
                  ? "—"
                  : `${(s.maxDrawdownPct * 100).toFixed(2)}%`}
              </div>
            </Panel>
            <Panel>
              <div className="text-xs uppercase text-[var(--muted)]">
                # Trades
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {s.tradeCount}
              </div>
            </Panel>
            <Panel className="col-span-2 lg:col-span-1">
              <div className="text-xs uppercase text-[var(--muted)]">
                Accuracy
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {s.accuracy == null ? "—" : `${(s.accuracy * 100).toFixed(0)}%`}
              </div>
            </Panel>
          </div>

          <Panel title={`Simulated decisions (${result.symbols.join(", ")})`}>
            <p className="mb-2 text-xs text-[var(--muted)]">
              Bars used {result.barsUsed} · BUY {s.buy} · SELL {s.sell} · HOLD{" "}
              {s.hold}
              {result.startDate || result.endDate
                ? ` · window ${result.startDate ?? "…"} → ${result.endDate ?? "…"}`
                : ""}
            </p>
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
                    <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase">
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Action</th>
                      <th className="py-2 pr-3 font-medium">Price</th>
                      <th className="py-2 pr-3 font-medium">Conf.</th>
                      <th className="py-2 font-medium">Est. P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.decisions.slice(0, 50).map((d, i) => (
                      <tr
                        key={`${d.symbol}-${d.timestamp}-${i}`}
                        className="border-b border-[var(--border)]/50"
                      >
                        <td className="py-2 pr-3 text-[var(--muted)] whitespace-nowrap">
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
          </Panel>
        </>
      )}
    </div>
  );
}
