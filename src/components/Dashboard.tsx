"use client";

import { useState, useTransition } from "react";
import { formatMoney, formatNumber, formatTime } from "@/lib/format";
import type {
  AiDecision,
  DecisionHistoryEntry,
  MarketClockStatus,
} from "@/lib/alpaca/types";
import type {
  AccountPayload,
  AiHealthPayload,
  DashboardData,
  DecisionPayload,
  MarketPayload,
  NewsPayload,
  PerformancePayload,
  SafetyPayload,
  TradeRow,
} from "@/lib/dashboard-types";
import type { BacktestResult } from "@/lib/performance/types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data;
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="text-sm font-semibold tracking-wide text-[var(--muted)] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ActionBadge({ action }: { action: string }) {
  const normalized = action.toUpperCase();
  const tone =
    normalized === "BUY"
      ? "bg-emerald-500/15 text-emerald-300"
      : normalized === "SELL"
        ? "bg-rose-500/15 text-rose-300"
        : "bg-zinc-500/20 text-zinc-300";

  return (
    <span
      className={`inline-flex px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${tone}`}
    >
      {normalized}
    </span>
  );
}

function RiskBadge({ status }: { status?: string }) {
  if (!status) return null;
  const tone =
    status === "high"
      ? "text-rose-300"
      : status === "elevated"
        ? "text-amber-300"
        : status === "low"
          ? "text-emerald-300"
          : "text-[var(--muted)]";
  return (
    <span className={`text-xs uppercase tracking-wide ${tone}`}>{status}</span>
  );
}

function MarketBanner({ clock }: { clock: MarketClockStatus | null }) {
  if (!clock) {
    return (
      <div className="border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)]">
        Market clock unavailable
      </div>
    );
  }

  const open = clock.isOpen;
  return (
    <div
      className={`border px-4 py-3 text-sm ${
        open
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
          : "border-amber-500/40 bg-amber-500/10 text-amber-100"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-semibold tracking-wide uppercase">
          Market {open ? "Open" : "Closed"}
        </span>
        <span className="text-xs opacity-90">
          Next open {formatTime(clock.nextOpen)}
        </span>
        <span className="text-xs opacity-90">
          Next close {formatTime(clock.nextClose)}
        </span>
      </div>
      {!open && (
        <p className="mt-1 text-xs opacity-90">
          Aggressive BUY/SELL blocked while closed — decisions default to HOLD.
        </p>
      )}
    </div>
  );
}

export function Dashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [isPending, startTransition] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);

  function refresh() {
    setRefreshError(null);
    startTransition(() => {
      void (async () => {
        try {
          const [
            safety,
            account,
            market,
            decisionRes,
            historyRes,
            tradesRes,
            clockRes,
            newsRes,
            aiHealthRes,
            performanceRes,
            backtestRes,
          ] = await Promise.all([
            fetchJson<SafetyPayload>("/api/safety"),
            fetchJson<AccountPayload>("/api/account"),
            fetchJson<MarketPayload>("/api/market"),
            fetchJson<DecisionPayload>("/api/ai/decision"),
            fetchJson<{ history: DecisionHistoryEntry[] }>("/api/ai/history"),
            fetchJson<{ trades: TradeRow[] }>("/api/trades"),
            fetchJson<{ clock: MarketClockStatus }>("/api/market/clock"),
            fetchJson<NewsPayload>("/api/news"),
            fetchJson<AiHealthPayload>("/api/ai/health"),
            fetchJson<PerformancePayload & { history: PerformancePayload["history"]; summary: PerformancePayload["summary"] }>("/api/performance"),
            fetchJson<BacktestResult>("/api/backtest"),
          ]);

          const decisionBySymbol = new Map(
            decisionRes.decisions.map((d) => [d.symbol, d]),
          );
          const clock = clockRes.clock ?? decisionRes.clock ?? market.clock ?? null;

          setData({
            ok: true,
            safety,
            account,
            clock,
            market: {
              ...market,
              clock,
              market: market.market.map((row) => ({
                ...row,
                decision: decisionBySymbol.get(row.symbol) ?? null,
                dataQuality:
                  row.dataQuality ??
                  decisionBySymbol.get(row.symbol)?.dataQuality ??
                  null,
              })),
            },
            decisions: decisionRes.decisions,
            news: {
              provider: newsRes.provider ?? decisionRes.news?.provider ?? "mock",
              bySymbol: newsRes.bySymbol ?? decisionRes.news?.bySymbol ?? {},
              status: newsRes.status ??
                decisionRes.news?.status ?? {
                  requestedProvider: "mock",
                  activeProvider: newsRes.provider ?? "mock",
                  usedFallback: false,
                  fallbackReason: null,
                  ok: true,
                },
              aiStatus: newsRes.aiStatus ??
                decisionRes.news?.aiStatus ?? {
                  requestedProvider: "heuristic",
                  activeProvider: "heuristic",
                  usedFallback: false,
                  fallbackReason: null,
                  model: null,
                  ok: true,
                },
            },
            decisionHistory: historyRes.history,
            trades: tradesRes.trades,
            aiHealth: aiHealthRes,
            performance: {
              history: performanceRes.history ?? [],
              summary: performanceRes.summary,
            },
            backtest: backtestRes,
            error: null,
            loadedAt: new Date().toISOString(),
            orderExecutionEnabled: false,
          });
        } catch (err) {
          setRefreshError(
            err instanceof Error ? err.message : "Failed to refresh dashboard",
          );
        }
      })();
    });
  }

  const {
    account,
    market,
    decisions,
    decisionHistory,
    trades,
    safety,
    clock,
    news,
    aiHealth,
    performance,
    backtest,
  } = data;
  const error = refreshError ?? data.error;
  const currency = account?.account.currency ?? "USD";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-amber-400/90 uppercase">
            Paper trading only · no auto-execution
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl tracking-tight text-[var(--foreground)] sm:text-4xl">
            TradingAI
          </h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
            Phase 3: news/event analysis for decision support. Orders stay
            disabled; safety HOLDs still win.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div
            className={`text-xs font-medium ${
              safety.ok ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {safety.ok
              ? `Safety OK · ${safety.tradingEndpoint ?? "paper-api"}`
              : safety.error
                ? `Safety fail · ${safety.error}`
                : "Safety check incomplete"}
          </div>
          <p className="text-xs text-amber-200/80">Order execution: OFF</p>
          <button
            type="button"
            onClick={refresh}
            disabled={isPending}
            className="border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-1.5 text-sm text-[var(--foreground)] transition hover:border-amber-500/50 disabled:opacity-50"
          >
            {isPending ? "Refreshing…" : "Refresh"}
          </button>
          <p className="text-xs text-[var(--muted)]">
            Updated {formatTime(data.loadedAt)}
          </p>
        </div>
      </header>

      <MarketBanner clock={clock} />

      <nav className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
        <a href="#news-events" className="underline-offset-2 hover:text-amber-300 hover:underline">
          Jump to News &amp; Events
        </a>
        <a href="#watchlist" className="underline-offset-2 hover:text-amber-300 hover:underline">
          Watchlist
        </a>
        <a href="#performance" className="underline-offset-2 hover:text-amber-300 hover:underline">
          Performance
        </a>
        <a href="#backtest" className="underline-offset-2 hover:text-amber-300 hover:underline">
          Backtest
        </a>
      </nav>

      {error && (
        <div className="border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
          <p className="mt-1 text-xs text-rose-200/70">
            Ensure `.env.local` has paper API keys and{" "}
            <code className="font-mono">ALPACA_BASE_URL</code> points to
            paper-api only.
          </p>
        </div>
      )}

      <Panel title="Balance">
        {account ? (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-[var(--muted)]">Equity</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                {formatMoney(account.account.equity, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Cash</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">
                {formatMoney(account.account.cash, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Buying power</dt>
              <dd className="mt-0.5 tabular-nums">
                {formatMoney(account.account.buyingPower, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Portfolio value</dt>
              <dd className="mt-0.5 tabular-nums">
                {formatMoney(account.account.portfolioValue, currency)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-[var(--muted)]">No account data</p>
        )}
      </Panel>

      <section id="news-events" className="scroll-mt-6">
        <Panel title="News & Events">
          {news && Object.keys(news.bySymbol).length > 0 ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 text-sm">
                <p className="text-[var(--foreground)]/90">
                  News source:{" "}
                  <code className="font-mono text-amber-200/90">
                    {news.status?.activeProvider ?? news.provider}
                  </code>
                  {news.status?.requestedProvider &&
                    news.status.requestedProvider !==
                      news.status.activeProvider && (
                      <span className="text-[var(--muted)]">
                        {" "}
                        (requested{" "}
                        <code className="font-mono">
                          {news.status.requestedProvider}
                        </code>
                        )
                      </span>
                    )}
                  {" · "}
                  AI provider:{" "}
                  <code className="font-mono text-amber-200/90">
                    {news.aiStatus?.requestedProvider === "ollama"
                      ? "ollama"
                      : (news.aiStatus?.activeProvider ??
                        aiHealth?.requestedProvider ??
                        "heuristic")}
                  </code>
                  {news.aiStatus?.model && (
                    <span className="text-[var(--muted)]">
                      {" "}
                      ({news.aiStatus.model})
                    </span>
                  )}
                  {" · "}
                  Ollama status:{" "}
                  <span
                    className={
                      (aiHealth?.statusLabel ??
                        (news.aiStatus?.usedFallback
                          ? "fallback"
                          : news.aiStatus?.activeProvider === "ollama"
                            ? "connected"
                            : "heuristic")) === "connected"
                        ? "text-emerald-300"
                        : (aiHealth?.statusLabel ??
                              (news.aiStatus?.usedFallback
                                ? "fallback"
                                : "heuristic")) === "fallback"
                          ? "text-amber-300"
                          : "text-[var(--muted)]"
                    }
                  >
                    {aiHealth?.statusLabel ??
                      (news.aiStatus?.requestedProvider !== "ollama"
                        ? "heuristic"
                        : news.aiStatus?.usedFallback
                          ? "fallback"
                          : news.aiStatus?.activeProvider === "ollama"
                            ? "connected"
                            : "fallback")}
                  </span>
                  . Decision support only — does not place trades.
                </p>
                {aiHealth?.ollama.message &&
                  aiHealth.requestedProvider === "ollama" && (
                    <p className="text-xs text-[var(--muted)]">
                      {aiHealth.ollama.message}
                      {aiHealth.ollama.latencyMs != null
                        ? ` · health ${aiHealth.ollama.latencyMs}ms`
                        : ""}
                    </p>
                  )}
                {news.status?.usedFallback && (
                  <p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-100">
                    News fallback:{" "}
                    {news.status.fallbackReason ??
                      "Using mock news because the real provider was unavailable."}
                  </p>
                )}
                {(news.aiStatus?.usedFallback ||
                  aiHealth?.statusLabel === "fallback") && (
                  <p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-100">
                    AI fallback:{" "}
                    {news.aiStatus?.fallbackReason ??
                      aiHealth?.ollama.message ??
                      "Ollama unavailable — using heuristic scoring."}
                  </p>
                )}
              </div>
              {Object.values(news.bySymbol).map((analysis) => {
                const d = decisions.find((x) => x.symbol === analysis.symbol);
                return (
                  <div
                    key={analysis.symbol}
                    className="border border-amber-500/25 bg-[var(--panel-elevated)] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xl font-semibold tracking-tight">
                        {analysis.symbol}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                        overall sentiment: {analysis.overallSentiment ?? "n/a"}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                        highest importance: {analysis.highestImportance ?? "n/a"}
                      </span>
                      {d && <ActionBadge action={d.action} />}
                    </div>
                    <p className="mt-2 text-sm text-[var(--foreground)]/90">
                      <span className="text-[var(--muted)]">
                        AI explanation ({analysis.aiProvider ?? news.aiStatus?.activeProvider ?? "heuristic"}):{" "}
                      </span>
                      {d?.newsContext?.explanation ?? analysis.explanation}
                    </p>
                    {analysis.shortTermImpact && (
                      <p className="mt-1 text-sm text-[var(--foreground)]/85">
                        <span className="text-[var(--muted)]">Short-term impact: </span>
                        {analysis.shortTermImpact}
                      </p>
                    )}
                    {analysis.riskWarning && (
                      <p className="mt-1 text-sm text-amber-200/90">
                        <span className="text-[var(--muted)]">Risk warning: </span>
                        {analysis.riskWarning}
                      </p>
                    )}
                    {analysis.items.length > 0 ? (
                      <ul className="mt-4 space-y-4">
                        {analysis.items.map((item) => (
                          <li
                            key={item.id}
                            className="border-t border-[var(--border)]/80 pt-3 text-sm"
                          >
                            <div>
                              <span className="text-[var(--muted)]">Headline: </span>
                              <span className="font-medium">{item.headline}</span>
                            </div>
                            <div className="mt-1 text-[var(--muted)]">
                              <span>Source: {item.source}</span>
                              {" · "}
                              <span>Published: {formatTime(item.publishedAt)}</span>
                              {item.url && (
                                <>
                                  {" · "}
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-amber-300 underline-offset-2 hover:underline"
                                  >
                                    Open article
                                  </a>
                                </>
                              )}
                            </div>
                            <div className="mt-1">
                              <span className="text-[var(--muted)]">Sentiment: </span>
                              {item.sentiment}
                              {" · "}
                              <span className="text-[var(--muted)]">Importance: </span>
                              {item.importance}
                            </div>
                            <div className="mt-1 text-[var(--foreground)]/85">
                              <span className="text-[var(--muted)]">Summary: </span>
                              {item.summary}
                            </div>
                            <div className="mt-1 text-amber-200/90">
                              <span className="text-[var(--muted)]">
                                Possible market impact:{" "}
                              </span>
                              {item.possibleMarketImpact}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        No headlines for this symbol.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-[var(--muted)]">
                No news loaded. Decisions still work without news.
              </p>
              {news?.status?.usedFallback && (
                <p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-100">
                  Fallback warning:{" "}
                  {news.status.fallbackReason ??
                    "News provider fell back or returned no items."}
                </p>
              )}
            </div>
          )}
        </Panel>
      </section>

      <section id="watchlist" className="scroll-mt-6">
      <Panel title="Watchlist & AI decisions">
        {market && market.market.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase tracking-wide">
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">Last</th>
                  <th className="py-2 pr-3 font-medium">Bid / Ask</th>
                  <th className="py-2 pr-3 font-medium">Freshness</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">Conf.</th>
                  <th className="py-2 pr-3 font-medium">Risk</th>
                  <th className="py-2 font-medium">Reasons / quality</th>
                </tr>
              </thead>
              <tbody>
                {market.market.map((row) => {
                  const d: AiDecision | null | undefined =
                    row.decision ??
                    decisions.find((x) => x.symbol === row.symbol);
                  const dq = row.dataQuality ?? d?.dataQuality;
                  const freshness = !dq
                    ? "—"
                    : dq.isQuoteStale
                      ? "Stale"
                      : "Fresh";
                  const spreadLabel =
                    dq?.spreadPercent != null
                      ? `${(dq.spreadPercent * 100).toFixed(2)}%`
                      : "—";

                  return (
                    <tr
                      key={row.symbol}
                      className="border-b border-[var(--border)]/60 align-top last:border-0"
                    >
                      <td className="py-3 pr-3 font-semibold">{row.symbol}</td>
                      <td className="py-3 pr-3 tabular-nums">
                        {formatNumber(row.last ?? row.mid)}
                      </td>
                      <td className="py-3 pr-3 tabular-nums text-[var(--muted)]">
                        {formatNumber(row.bid)} / {formatNumber(row.ask)}
                        <div className="text-xs">spread {spreadLabel}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className={
                            dq?.isQuoteStale
                              ? "text-amber-300"
                              : "text-emerald-300"
                          }
                        >
                          {freshness}
                        </span>
                        <div className="text-xs text-[var(--muted)]">
                          {formatTime(row.timestamp)}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        {d ? <ActionBadge action={d.action} /> : "—"}
                      </td>
                      <td className="py-3 pr-3 tabular-nums">
                        {d ? `${(d.confidence * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td className="py-3 pr-3">
                        <RiskBadge status={d?.riskStatus} />
                      </td>
                      <td className="py-3 max-w-md">
                        {d ? (
                          <ul className="list-disc space-y-0.5 pl-4 text-xs text-[var(--foreground)]/85">
                            {d.reasons.slice(0, 3).map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                            {(dq?.warningMessages ?? d.riskWarnings)
                              .slice(0, 2)
                              .map((w) => (
                                <li key={w} className="text-amber-200/90">
                                  {w}
                                </li>
                              ))}
                          </ul>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Watchlist from <code className="font-mono">WATCHLIST</code> env ·{" "}
              {market.watchlist.join(", ")}
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">No watchlist quotes</p>
        )}
      </Panel>
      </section>

      <section id="performance" className="scroll-mt-6">
        <Panel title="Decision performance (paper estimate)">
          {performance?.summary ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[var(--muted)]">
                Tracks decisions without placing orders. Outcomes use later
                prices (15m / 1h / approx next close) when available.
              </p>
              <div className="grid gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <div className="text-[var(--muted)]">Decisions logged</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {performance.summary.totalDecisions}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--muted)]">Evaluated</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {performance.summary.evaluated}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--muted)]">Order execution</div>
                  <div className="text-xl font-semibold text-amber-200">OFF</div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {(
                  [
                    ["By symbol", performance.summary.bySymbol],
                    ["By action", performance.summary.byAction],
                    ["Confidence vs result", performance.summary.confidenceBuckets],
                  ] as const
                ).map(([title, rows]) => (
                  <div key={title}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {title}
                    </h3>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                          <th className="py-1 pr-2 font-medium">Key</th>
                          <th className="py-1 pr-2 font-medium">Acc.</th>
                          <th className="py-1 font-medium">Est. PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-2 text-[var(--muted)]">
                              No data yet
                            </td>
                          </tr>
                        ) : (
                          rows.map((r) => (
                            <tr
                              key={r.key}
                              className="border-b border-[var(--border)]/50"
                            >
                              <td className="py-1.5 pr-2 font-medium">{r.key}</td>
                              <td className="py-1.5 pr-2 tabular-nums">
                                {r.accuracy == null
                                  ? "—"
                                  : `${(r.accuracy * 100).toFixed(0)}%`}
                              </td>
                              <td className="py-1.5 tabular-nums">
                                {r.avgEstimatedPnlPct == null
                                  ? "—"
                                  : `${(r.avgEstimatedPnlPct * 100).toFixed(2)}%`}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase tracking-wide">
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Symbol</th>
                      <th className="py-2 pr-3 font-medium">Action</th>
                      <th className="py-2 pr-3 font-medium">Price</th>
                      <th className="py-2 pr-3 font-medium">Outcome</th>
                      <th className="py-2 pr-3 font-medium">Est. PnL</th>
                      <th className="py-2 font-medium">Context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.history.slice(0, 20).map((h) => {
                      const pnl =
                        h.outcomes.h1.estimatedPnlPct ??
                        h.outcomes.m15.estimatedPnlPct ??
                        h.outcomes.nextClose.estimatedPnlPct;
                      return (
                        <tr
                          key={h.id}
                          className="border-b border-[var(--border)]/60 align-top last:border-0"
                        >
                          <td className="py-2.5 pr-3 text-[var(--muted)] whitespace-nowrap">
                            {formatTime(h.timestamp)}
                          </td>
                          <td className="py-2.5 pr-3 font-semibold">{h.symbol}</td>
                          <td className="py-2.5 pr-3">
                            <ActionBadge action={h.action} />
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {formatNumber(h.priceAtDecision)}
                          </td>
                          <td className="py-2.5 pr-3 text-xs uppercase tracking-wide">
                            {h.overallLabel}
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {pnl == null ? "—" : `${(pnl * 100).toFixed(2)}%`}
                          </td>
                          <td className="py-2.5 text-xs text-[var(--muted)]">
                            {h.marketOpen ? "open" : "closed"} ·{" "}
                            {h.newsSentiment ?? "n/a"} · {h.aiProvider}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No performance data yet. Refresh to log decisions.
            </p>
          )}
        </Panel>
      </section>

      <section id="backtest" className="scroll-mt-6">
        <Panel title="Simple backtest (historical bars)">
          {backtest ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-[var(--muted)]">
                Replays decision logic on recent 5-minute bars. No orders placed
                (paper simulation only).
              </p>
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-[var(--muted)]">Sim decisions</div>
                  <div className="text-xl font-semibold tabular-nums">
                    {backtest.summary.total}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--muted)]">BUY / SELL / HOLD</div>
                  <div className="tabular-nums">
                    {backtest.summary.buy} / {backtest.summary.sell} /{" "}
                    {backtest.summary.hold}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--muted)]">Accuracy</div>
                  <div className="tabular-nums">
                    {backtest.summary.accuracy == null
                      ? "—"
                      : `${(backtest.summary.accuracy * 100).toFixed(0)}%`}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--muted)]">Avg est. PnL</div>
                  <div className="tabular-nums">
                    {backtest.summary.avgEstimatedPnlPct == null
                      ? "—"
                      : `${(backtest.summary.avgEstimatedPnlPct * 100).toFixed(2)}%`}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase tracking-wide">
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Symbol</th>
                      <th className="py-2 pr-3 font-medium">Action</th>
                      <th className="py-2 pr-3 font-medium">Price</th>
                      <th className="py-2 pr-3 font-medium">Fwd</th>
                      <th className="py-2 font-medium">Est. PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backtest.decisions.slice(0, 15).map((d, i) => (
                      <tr
                        key={`${d.symbol}-${d.timestamp}-${i}`}
                        className="border-b border-[var(--border)]/60 last:border-0"
                      >
                        <td className="py-2 pr-3 text-[var(--muted)] whitespace-nowrap">
                          {formatTime(d.timestamp)}
                        </td>
                        <td className="py-2 pr-3 font-semibold">{d.symbol}</td>
                        <td className="py-2 pr-3">
                          <ActionBadge action={d.action} />
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {formatNumber(d.price)}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {d.forwardReturnPct == null
                            ? "—"
                            : `${(d.forwardReturnPct * 100).toFixed(2)}%`}
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
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Backtest unavailable.</p>
          )}
        </Panel>
      </section>

      <Panel title="Decision history (local)">
        {decisionHistory.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase tracking-wide">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">Conf.</th>
                  <th className="py-2 font-medium">Reasons</th>
                </tr>
              </thead>
              <tbody>
                {decisionHistory.slice(0, 25).map((h, i) => (
                  <tr
                    key={`${h.symbol}-${h.timestamp}-${i}`}
                    className="border-b border-[var(--border)]/60 align-top last:border-0"
                  >
                    <td className="py-2.5 pr-3 text-[var(--muted)] whitespace-nowrap">
                      {formatTime(h.timestamp)}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold">{h.symbol}</td>
                    <td className="py-2.5 pr-3">
                      <ActionBadge action={h.action} />
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {(h.confidence * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 text-xs text-[var(--foreground)]/80">
                      {h.reasons.slice(0, 2).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No local decision history yet. Refresh to generate and log
            decisions.
          </p>
        )}
      </Panel>

      <Panel title="Trade history (paper, read-only)">
        {trades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase tracking-wide">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">Side</th>
                  <th className="py-2 pr-3 font-medium">Qty</th>
                  <th className="py-2 pr-3 font-medium">Fill</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--border)]/60 last:border-0"
                  >
                    <td className="py-2.5 pr-3 text-[var(--muted)]">
                      {formatTime(t.filledAt ?? t.submittedAt)}
                    </td>
                    <td className="py-2.5 pr-3 font-semibold">{t.symbol}</td>
                    <td className="py-2.5 pr-3">
                      <ActionBadge action={t.side} />
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {t.filledQty || t.qty || "—"}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {formatMoney(t.filledAvgPrice, currency)}
                    </td>
                    <td className="py-2.5 text-[var(--muted)]">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No paper orders yet. This app does not place trades in Phase 2.5.
          </p>
        )}
      </Panel>
    </div>
  );
}
