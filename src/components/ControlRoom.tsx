"use client";

import { Fragment, useState, useTransition } from "react";
import { formatMoney, formatNumber, formatTime } from "@/lib/format";
import { fetchJson } from "@/lib/client/fetch-json";
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
import type { MarketCondition } from "@/lib/stocks/market-condition";
import type {
  PaperOrderPreview,
  PaperOrderSubmitResult,
} from "@/lib/trades/types";
import { actionToSide, canShowPreparePaperTrade } from "@/lib/trades/gates";
import { Panel } from "@/components/ui/Panel";
import {
  ActionBadge,
  RiskBadge,
  SentimentBadge,
} from "@/components/ui/badges";
import { BlockReasonList } from "@/components/ui/BlockReasonList";
import { EmptyState } from "@/components/ui/EmptyState";
import { PaperOnlyBanner } from "@/components/ui/PaperOnlyBanner";
import { ScrollTable } from "@/components/ui/ScrollTable";
import { uniqueBlockLabels } from "@/lib/client/block-reasons";

function trendLabel(d: AiDecision | null | undefined): string {
  const pct = d?.metrics?.trendPct;
  if (pct == null) return "—";
  if (pct > 0.0015) return `Up ${(pct * 100).toFixed(2)}%`;
  if (pct < -0.0015) return `Down ${(pct * 100).toFixed(2)}%`;
  return `Flat ${(pct * 100).toFixed(2)}%`;
}

function volumeLabel(d: AiDecision | null | undefined): string {
  const r = d?.metrics?.volumeRatio;
  if (r == null) return "—";
  if (r >= 1.4) return `Strong ${r.toFixed(2)}x`;
  if (r < 0.7) return `Light ${r.toFixed(2)}x`;
  return `Avg ${r.toFixed(2)}x`;
}

function collectBlockReasons(
  d: AiDecision | null,
  orderExecutionEnabled: boolean,
): string[] {
  const raw: string[] = [];
  if (!orderExecutionEnabled) {
    raw.push("Order execution off");
  }
  if (d?.tradeBlockReasons?.length) {
    raw.push(...d.tradeBlockReasons);
  }
  if (d?.dataQuality && !d.dataQuality.isMarketOpen) {
    raw.push("Market closed");
  }
  if (d?.dataQuality?.isQuoteStale) {
    raw.push("Stale quote");
  }
  if (
    d?.dataQuality?.spreadPercent != null &&
    d.dataQuality.spreadPercent >= 0.01
  ) {
    raw.push("Wide spread");
  }
  if (d?.riskStatus === "high" || d?.riskLevel === "high") {
    raw.push("High risk");
  }
  if (d?.action === "HOLD") {
    raw.push("HOLD — not tradeable");
  }
  return uniqueBlockLabels(raw);
}

function MarketConditionBanner({
  condition,
}: {
  condition: MarketCondition | null;
}) {
  if (!condition) {
    return (
      <div className="border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)]">
        Market condition (SPY/QQQ) unavailable
      </div>
    );
  }
  const tone =
    condition.label === "bullish"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : condition.label === "bearish"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-100"
        : "border-amber-500/40 bg-amber-500/10 text-amber-100";
  return (
    <div className={`border px-4 py-3 text-sm ${tone}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-semibold tracking-wide uppercase">
          Market {condition.label}
        </span>
        <span className="text-xs opacity-90">
          Score {(condition.marketScore * 100).toFixed(0)}%
        </span>
        <span className="text-xs opacity-90">
          SPY{" "}
          {condition.spyTrendPct == null
            ? "—"
            : `${(condition.spyTrendPct * 100).toFixed(2)}%`}
        </span>
        <span className="text-xs opacity-90">
          QQQ{" "}
          {condition.qqqTrendPct == null
            ? "—"
            : `${(condition.qqqTrendPct * 100).toFixed(2)}%`}
        </span>
      </div>
      <p className="mt-1 text-xs opacity-90">{condition.explanation}</p>
    </div>
  );
}

export function ControlRoom({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [isPending, startTransition] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tradeQty, setTradeQty] = useState(1);
  const [preview, setPreview] = useState<PaperOrderPreview | null>(null);
  const [approved, setApproved] = useState(false);
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeResult, setTradeResult] = useState<PaperOrderSubmitResult | null>(
    null,
  );

  async function preparePaperTrade(decision: AiDecision) {
    const side = actionToSide(decision.action);
    if (!side) return;
    setTradeError(null);
    setTradeResult(null);
    setApproved(false);
    setTradeBusy(true);
    try {
      const body = await fetchJson<PaperOrderPreview>("/api/trades/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: decision.symbol,
          side,
          qty: tradeQty,
          action: decision.action,
          riskStatus: decision.riskStatus,
        }),
      });
      setPreview(body);
    } catch (err) {
      setPreview(null);
      setTradeError(
        err instanceof Error ? err.message : "Failed to prepare paper trade",
      );
    } finally {
      setTradeBusy(false);
    }
  }

  async function submitPaperTrade() {
    if (!preview || !approved) return;
    setTradeError(null);
    setTradeBusy(true);
    try {
      const res = await fetch("/api/trades/submit-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          symbol: preview.symbol,
          side: preview.side,
          qty: preview.qty,
          action: preview.action,
          riskStatus: preview.riskStatus,
          confirmed: true,
          manualApproval: true,
        }),
      });
      const body = (await res.json()) as PaperOrderSubmitResult & {
        error?: string;
      };
      setTradeResult(body);
      if (body.preview) setPreview(body.preview);
      if (!body.submitted) {
        setTradeError(body.error ?? "Paper order was blocked");
      } else {
        setApproved(false);
        refresh();
      }
    } catch (err) {
      setTradeError(
        err instanceof Error ? err.message : "Failed to submit paper order",
      );
    } finally {
      setTradeBusy(false);
    }
  }

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
          ] = await Promise.all([
            fetchJson<SafetyPayload>("/api/safety"),
            fetchJson<AccountPayload>("/api/account"),
            fetchJson<MarketPayload>("/api/market"),
            fetchJson<DecisionPayload>("/api/ai/decision"),
            fetchJson<{ history: DecisionHistoryEntry[] }>("/api/ai/history"),
            fetchJson<{
              trades: TradeRow[];
              orderExecutionEnabled?: boolean;
            }>("/api/trades"),
            fetchJson<{ clock: MarketClockStatus }>("/api/market/clock"),
            fetchJson<NewsPayload>("/api/news"),
            fetchJson<AiHealthPayload>("/api/ai/health"),
            fetchJson<PerformancePayload>("/api/performance"),
          ]);

          const decisionBySymbol = new Map(
            decisionRes.decisions.map((d) => [d.symbol, d]),
          );
          const clock =
            clockRes.clock ?? decisionRes.clock ?? market.clock ?? null;

          setData({
            ...data,
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
            marketCondition: decisionRes.marketCondition ?? null,
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
            error: null,
            loadedAt: new Date().toISOString(),
            orderExecutionEnabled:
              tradesRes.orderExecutionEnabled ??
              decisionRes.orderExecutionEnabled ??
              aiHealthRes.orderExecutionEnabled ??
              false,
          });
        } catch (err) {
          setRefreshError(
            err instanceof Error ? err.message : "Failed to refresh",
          );
        }
      })();
    });
  }

  const {
    account,
    market,
    decisions,
    trades,
    clock,
    marketCondition,
    orderExecutionEnabled,
  } = data;
  const error = refreshError ?? data.error;
  const currency = account?.account.currency ?? "USD";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Control Room
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            U.S. stock watchlist · score breakdown · manual paper approval
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={refresh}
            disabled={isPending}
            className="border border-[var(--border)] bg-[var(--panel-elevated)] px-3 py-1.5 text-sm transition hover:border-amber-500/50 disabled:opacity-50"
          >
            {isPending ? "Refreshing…" : "Refresh"}
          </button>
          <p className="text-xs text-[var(--muted)]">
            Updated {formatTime(data.loadedAt)}
          </p>
        </div>
      </div>

      {error && (
        <div className="border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      <PaperOnlyBanner detail="manual approval required · no one-click trading" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <Panel>
          <div className="text-[var(--muted)] text-xs uppercase tracking-wide">
            Equity
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {formatMoney(account?.account.equity, currency)}
          </div>
        </Panel>
        <Panel>
          <div className="text-[var(--muted)] text-xs uppercase tracking-wide">
            Cash
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {formatMoney(account?.account.cash, currency)}
          </div>
        </Panel>
        <Panel>
          <div className="text-[var(--muted)] text-xs uppercase tracking-wide">
            Buying power
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {formatMoney(account?.account.buyingPower, currency)}
          </div>
        </Panel>
        <Panel>
          <div className="text-[var(--muted)] text-xs uppercase tracking-wide">
            Market clock
          </div>
          <div className="mt-1 text-xl font-semibold">
            {clock?.isOpen ? "Open" : clock ? "Closed" : "—"}
          </div>
        </Panel>
      </div>

      <MarketConditionBanner condition={marketCondition} />

      <Panel title="Watchlist (U.S. stocks)">
        {market && market.market.length > 0 ? (
          <ScrollTable minWidthClass="min-w-[52rem] lg:min-w-[64rem]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase tracking-wide">
                  <th className="py-2 pr-2 font-medium">Symbol</th>
                  <th className="py-2 pr-2 font-medium">Last</th>
                  <th className="py-2 pr-2 font-medium">Trend</th>
                  <th className="py-2 pr-2 font-medium">Volume</th>
                  <th className="py-2 pr-2 font-medium">News</th>
                  <th className="py-2 pr-2 font-medium">Tech</th>
                  <th className="py-2 pr-2 font-medium">Mkt</th>
                  <th className="py-2 pr-2 font-medium">Risk</th>
                  <th className="py-2 pr-2 font-medium">Decision</th>
                  <th className="py-2 pr-2 font-medium">Conf.</th>
                  <th className="py-2 font-medium">Blocked / trade</th>
                </tr>
              </thead>
              <tbody>
                {market.market.map((row) => {
                  const d =
                    row.decision ??
                    decisions.find((x) => x.symbol === row.symbol) ??
                    null;
                  const isOpen = expanded === row.symbol;
                  const canPrepare = d != null && canShowPreparePaperTrade(d);
                  const blockReasons = collectBlockReasons(
                    d,
                    orderExecutionEnabled,
                  );

                  return (
                    <Fragment key={row.symbol}>
                      <tr className="border-b border-[var(--border)]/50 align-top">
                        <td className="py-2.5 pr-2">
                          <button
                            type="button"
                            className="font-semibold text-left hover:text-amber-200"
                            onClick={() =>
                              setExpanded(isOpen ? null : row.symbol)
                            }
                          >
                            {row.symbol}
                            <span className="ml-1 text-[10px] text-[var(--muted)]">
                              {isOpen ? "▾" : "▸"}
                            </span>
                          </button>
                        </td>
                        <td className="py-2.5 pr-2 tabular-nums">
                          {formatNumber(row.last ?? row.mid)}
                        </td>
                        <td className="py-2.5 pr-2 text-xs">{trendLabel(d)}</td>
                        <td className="py-2.5 pr-2 text-xs">
                          {volumeLabel(d)}
                        </td>
                        <td className="py-2.5 pr-2">
                          <SentimentBadge
                            sentiment={d?.newsContext?.overallSentiment}
                          />
                        </td>
                        <td className="py-2.5 pr-2 tabular-nums text-xs">
                          {d?.scores
                            ? `${(d.scores.technicalScore * 100).toFixed(0)}`
                            : "—"}
                        </td>
                        <td className="py-2.5 pr-2 tabular-nums text-xs">
                          {d?.scores
                            ? `${(d.scores.marketScore * 100).toFixed(0)}`
                            : "—"}
                        </td>
                        <td className="py-2.5 pr-2">
                          <div className="flex flex-col gap-0.5">
                            <RiskBadge
                              status={d?.riskLevel ?? d?.riskStatus}
                            />
                            <span className="text-[10px] tabular-nums text-[var(--muted)]">
                              {d?.scores
                                ? `${(d.scores.riskScore * 100).toFixed(0)}`
                                : ""}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-2">
                          {d ? <ActionBadge action={d.action} /> : "—"}
                        </td>
                        <td className="py-2.5 pr-2 tabular-nums text-xs">
                          {d ? `${(d.confidence * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="py-2.5 max-w-[14rem]">
                          {canPrepare && d ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                                Ready for manual paper trade
                              </span>
                              <button
                                type="button"
                                disabled={tradeBusy}
                                onClick={() => void preparePaperTrade(d)}
                                className="border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-100 disabled:opacity-50"
                              >
                                Prepare Paper Trade
                              </button>
                            </div>
                          ) : (
                            <BlockReasonList
                              reasons={blockReasons}
                              emptyLabel="—"
                            />
                          )}
                        </td>
                      </tr>
                      {isOpen && d && (
                        <tr className="border-b border-[var(--border)]/60 bg-[var(--panel-elevated)]/40">
                          <td colSpan={11} className="px-3 py-3 text-sm">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                  Technical reason
                                </h3>
                                <p className="mt-1 text-[var(--foreground)]/90">
                                  {d.explanation?.technical ?? "—"}
                                </p>
                              </div>
                              <div>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                  News reason
                                </h3>
                                <p className="mt-1 text-[var(--foreground)]/90">
                                  {d.explanation?.news ?? "—"}
                                </p>
                              </div>
                              <div>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                  Market reason
                                </h3>
                                <p className="mt-1 text-[var(--foreground)]/90">
                                  {d.explanation?.market ?? "—"}
                                </p>
                              </div>
                              <div>
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                  Risk reason
                                </h3>
                                <p className="mt-1 text-[var(--foreground)]/90">
                                  {d.explanation?.risk ?? "—"}
                                </p>
                              </div>
                            </div>
                            <div className="mt-3 border-t border-[var(--border)] pt-3">
                              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">
                                Final decision (simple English)
                              </h3>
                              <p className="mt-1">
                                {d.explanation?.summary ??
                                  d.reasons[0] ??
                                  "—"}
                              </p>
                              {blockReasons.length > 0 && (
                                <div className="mt-2">
                                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-200/90">
                                    Why trade is blocked
                                  </p>
                                  <BlockReasonList reasons={blockReasons} />
                                </div>
                              )}
                              {d.scores && (
                                <p className="mt-2 text-xs text-[var(--muted)]">
                                  Scores — tech{" "}
                                  {(d.scores.technicalScore * 100).toFixed(0)} ·
                                  news {(d.scores.newsScore * 100).toFixed(0)} ·
                                  market{" "}
                                  {(d.scores.marketScore * 100).toFixed(0)} ·
                                  risk {(d.scores.riskScore * 100).toFixed(0)} ·
                                  final{" "}
                                  {(d.scores.finalScore * 100).toFixed(0)}
                                </p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
              <label className="flex items-center gap-2">
                Default qty
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={tradeQty}
                  onChange={(e) =>
                    setTradeQty(
                      Math.max(1, Math.floor(Number(e.target.value) || 1)),
                    )
                  }
                  className="w-16 border border-[var(--border)] bg-[var(--panel-elevated)] px-2 py-1 text-[var(--foreground)]"
                />
              </label>
              <span>
                Click a symbol to expand details ·{" "}
                {market.watchlist.join(", ")}
              </span>
            </div>
          </ScrollTable>
        ) : (
          <EmptyState title="No watchlist quotes">
            <p>Check Alpaca paper credentials and refresh.</p>
          </EmptyState>
        )}
      </Panel>

      <Panel title="Manual paper trade approval">
        <div className="mb-3 border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-semibold tracking-wide text-amber-100 uppercase">
          PAPER TRADE ONLY — not real money · no one-click trading · confirm
          required
        </div>
        {!orderExecutionEnabled && (
          <div className="mb-3">
            <BlockReasonList reasons={["Order execution off"]} />
            <p className="mt-2 text-sm text-amber-200/90">
              Set{" "}
              <code className="font-mono">
                ENABLE_PAPER_ORDER_EXECUTION=true
              </code>{" "}
              in <code className="font-mono">.env.local</code> to allow manual
              paper submits after confirmation.
            </p>
          </div>
        )}
        {tradeError && (
          <p className="mb-3 text-sm text-rose-300">{tradeError}</p>
        )}
        {preview ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <div className="text-[var(--muted)]">Symbol</div>
                <div className="font-semibold">{preview.symbol}</div>
              </div>
              <div>
                <div className="text-[var(--muted)]">Side</div>
                <ActionBadge action={preview.side} />
              </div>
              <div>
                <div className="text-[var(--muted)]">Quantity</div>
                <div className="tabular-nums">{preview.qty}</div>
              </div>
              <div>
                <div className="text-[var(--muted)]">Order type</div>
                <div className="uppercase">
                  {preview.orderType} / {preview.timeInForce}
                </div>
              </div>
              <div>
                <div className="text-[var(--muted)]">Est. price</div>
                <div className="tabular-nums">
                  {formatMoney(preview.estimatedPrice, currency)}
                </div>
              </div>
              <div>
                <div className="text-[var(--muted)]">Est. notional</div>
                <div className="tabular-nums">
                  {formatMoney(preview.estimatedNotional, currency)}
                  <span className="ml-1 text-xs text-[var(--muted)]">
                    (max {formatMoney(preview.maxNotional, currency)})
                  </span>
                </div>
              </div>
            </div>

            {preview.gates.blockers.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-300">
                  Blocked — cannot submit
                </h3>
                <BlockReasonList
                  reasons={preview.gates.blockers.map((b) => b.message)}
                />
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-[var(--muted)]">
                  {preview.gates.blockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
                className="mt-1"
              />
              <span>
                I understand this is a <strong>PAPER TRADE ONLY</strong> and I
                manually approve submitting this market order. This is not
                one-click trading.
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  tradeBusy ||
                  !approved ||
                  !preview.executionEnabled ||
                  preview.gates.blockers.length > 0
                }
                onClick={() => void submitPaperTrade()}
                className="border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-100 disabled:opacity-40"
              >
                {tradeBusy ? "Submitting…" : "Confirm & submit paper order"}
              </button>
              <button
                type="button"
                disabled={tradeBusy}
                onClick={() => {
                  setPreview(null);
                  setApproved(false);
                  setTradeResult(null);
                  setTradeError(null);
                }}
                className="border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Prepare a BUY/SELL from the watchlist to review the full order
            preview. Submit stays disabled until you check the confirmation box
            and all safety gates pass.
          </p>
        )}

        {tradeResult?.submitted && tradeResult.order && (
          <div className="mt-4 border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm">
            <p className="font-semibold text-emerald-200">
              Paper order submitted
            </p>
            <p className="mt-1 text-xs text-emerald-100/90">
              {tradeResult.order.side.toUpperCase()} {tradeResult.order.qty}{" "}
              {tradeResult.order.symbol} · {tradeResult.order.status} · id{" "}
              <code className="font-mono">{tradeResult.order.id}</code>
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Recent paper orders">
        {trades.length > 0 ? (
          <ScrollTable minWidthClass="min-w-[28rem] sm:min-w-[36rem]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">Side</th>
                  <th className="py-2 pr-3 font-medium">Qty</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 10).map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--border)]/50"
                  >
                    <td className="py-2 pr-3 text-[var(--muted)]">
                      {formatTime(t.filledAt ?? t.submittedAt)}
                    </td>
                    <td className="py-2 pr-3 font-semibold">{t.symbol}</td>
                    <td className="py-2 pr-3">
                      <ActionBadge action={t.side} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {t.filledQty || t.qty || "—"}
                    </td>
                    <td className="py-2 text-[var(--muted)]">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        ) : (
          <EmptyState title="No paper orders yet">
            <p>
              Approved paper trades will appear here after manual confirmation.
            </p>
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}
