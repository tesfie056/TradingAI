"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { useUiChrome } from "@/components/layout/UiChromeContext";
import { useMonitorStream } from "@/components/layout/MonitorStreamContext";
import { Panel } from "@/components/ui/Panel";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
import { InfoTip } from "@/components/ui/InfoTip";
import { StockSearch } from "@/components/stock/StockSearch";
import { AutoTradingActivity } from "@/components/status/AutoTradingActivity";
import { StatusReason } from "@/components/status/StatusReason";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatMoney, formatTime } from "@/lib/format";
import { getLocalWatchlistSymbols } from "@/lib/client/ui-settings";
import {
  buildRuntimeActivity,
  lastEvaluatedSymbolFromLogs,
  plainOpportunitySummary,
  resolveOverviewPrimaryBanner,
  type RuntimeStatusInput,
} from "@/lib/client/runtime-status-mapper";
import type { AiDecision, MarketClockStatus } from "@/lib/alpaca/types";
import type {
  AccountPayload,
  AiHealthPayload,
  SafetyPayload,
} from "@/lib/dashboard-types";
import type { MarketCondition } from "@/lib/stocks/market-condition";

type AutoTradeSnap = {
  dailyTradesUsed?: number;
  maxDailyTrades?: number;
  effectivelyEnabled?: boolean;
  envEnabled?: boolean;
  executionEnabled?: boolean;
  runtimeDisabled?: boolean;
  engine?: {
    autoTradingEnabled?: boolean;
    executionEnabled?: boolean;
    engineState?: string;
  };
  trader?: {
    equity?: number | null;
    dailyPnL?: number;
    openPositions?: { symbol: string; qty: number; unrealizedPl: number | null }[];
    marketOpen?: boolean | null;
    nextScanAt?: string | null;
  };
  recentDecisions?: {
    id: string;
    symbol: string;
    reason: string;
    status: string;
    createdAt: string;
  }[];
};

function toneClasses(tone: "ok" | "warn" | "neutral" | "bad"): string {
  if (tone === "ok") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-50";
  if (tone === "warn") return "border-amber-500/35 bg-amber-500/10 text-amber-50";
  if (tone === "bad") return "border-red-500/40 bg-red-950/35 text-red-50";
  return "border-[var(--border)] bg-[var(--panel-elevated)]/80 text-zinc-100";
}

function pnlClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-zinc-100";
  return n > 0 ? "text-emerald-300" : "text-red-300";
}

export function DashboardOverview({
  account,
  currency,
  clock,
  marketCondition: _marketCondition,
  orderExecutionEnabled,
  decisions,
  aiHealth: _aiHealth,
  simple: _simple,
  loadedAt,
  error,
  refresh,
  isPending,
  refreshAiHealth: _refreshAiHealth,
  aiHealthBusy: _aiHealthBusy,
}: {
  account: AccountPayload | null;
  currency: string;
  clock: MarketClockStatus | null;
  marketCondition: MarketCondition | null;
  orderExecutionEnabled: boolean;
  decisions: AiDecision[];
  aiHealth: AiHealthPayload | null;
  simple: boolean;
  loadedAt: string;
  error: string | null;
  refresh: () => void;
  isPending: boolean;
  refreshAiHealth: () => void;
  aiHealthBusy: boolean;
}) {
  const marketOpen = clock?.isOpen ?? null;
  const { openAi: _openAi } = useUiChrome();
  const stream = useMonitorStream();
  const [auto, setAuto] = useState<AutoTradeSnap | null>(null);
  const [safety, setSafety] = useState<SafetyPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [at, saf] = await Promise.all([
        fetchJson<AutoTradeSnap>("/api/auto-trade").catch(() => null),
        fetchJson<SafetyPayload>("/api/safety").catch(() => null),
      ]);
      if (cancelled) return;
      setAuto(at);
      setSafety(saf);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadedAt]);

  const monitor = stream.status;
  const autoOn =
    auto?.engine?.autoTradingEnabled ??
    auto?.effectivelyEnabled ??
    auto?.envEnabled ??
    false;
  const executionOn =
    auto?.engine?.executionEnabled ??
    auto?.executionEnabled ??
    orderExecutionEnabled;
  const positions = auto?.trader?.openPositions ?? [];
  const openCount = positions.length;
  const dailyPnL = auto?.trader?.dailyPnL ?? null;
  const equity = account?.account.equity ?? auto?.trader?.equity ?? null;
  const primary = positions[0] ?? null;
  const best = [...decisions].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
  )[0];
  const topOpp = monitor?.topOpportunity ?? null;

  const runtimeInput: RuntimeStatusInput = useMemo(() => {
    const lastEval =
      lastEvaluatedSymbolFromLogs(monitor?.recentLogs) ??
      (monitor?.scanning ? monitor.scannedSymbols?.at(-1) ?? null : null);
    return {
      autoTradingEnabled: autoOn,
      orderExecutionEnabled: executionOn,
      marketOpen: auto?.trader?.marketOpen ?? stream.marketOpen ?? marketOpen,
      monitorRunning: stream.workerRunning || Boolean(monitor?.running),
      monitorScanning: stream.scanning || Boolean(monitor?.scanning),
      monitorConnected: stream.connected,
      lastScanAt: monitor?.lastScanAt ?? null,
      nextScanAt:
        monitor?.nextScanAt ?? auto?.trader?.nextScanAt ?? null,
      stocksScanned: monitor?.stocksScanned ?? null,
      scannedSymbolsCount: monitor?.scannedSymbols?.length ?? null,
      watchlistSize: monitor?.scannedSymbols?.length ?? null,
      lastError: monitor?.lastError ?? null,
      heartbeatAt: stream.heartbeatAt ?? monitor?.heartbeatAt ?? null,
      engineState: auto?.engine?.engineState ?? null,
      runtimeDisabled: auto?.runtimeDisabled ?? null,
      safetyOk: safety?.ok ?? true,
      safetyLabel: safety?.ok
        ? null
        : (safety?.error?.slice(0, 80) ?? "Safety check failed"),
      lastEvaluatedSymbol: lastEval,
    };
  }, [
    autoOn,
    executionOn,
    auto?.trader?.marketOpen,
    auto?.trader?.nextScanAt,
    auto?.engine?.engineState,
    auto?.runtimeDisabled,
    stream.marketOpen,
    stream.workerRunning,
    stream.scanning,
    stream.connected,
    stream.heartbeatAt,
    marketOpen,
    monitor,
    safety?.ok,
    safety?.error,
  ]);

  const activity = buildRuntimeActivity(runtimeInput);
  const status = resolveOverviewPrimaryBanner(activity);
  const opportunity = topOpp
    ? plainOpportunitySummary({
        symbol: topOpp.symbol,
        action: topOpp.action,
        summary: topOpp.reason,
      })
    : best
      ? plainOpportunitySummary({
          symbol: best.symbol,
          action: best.decisionLabel ?? best.action,
          summary: best.explanation?.summary,
          reasons: best.reasons,
        })
      : null;

  const activityFeed = (auto?.recentDecisions ?? []).slice(0, 5);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Overview"
        description="Find a stock, check your desk, and review today’s paper activity."
        actions={
          <button
            type="button"
            onClick={refresh}
            disabled={isPending}
            className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] disabled:opacity-50"
          >
            {isPending ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      <StockSearch
        ownedSymbols={positions.map((p) => p.symbol)}
        knownSymbols={[
          ...new Set([
            ...getLocalWatchlistSymbols(),
            ...decisions.map((d) => d.symbol),
            ...positions.map((p) => p.symbol),
          ]),
        ]}
      />

      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-base text-rose-100">
          {error}
        </div>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric
          label="Account value"
          tip="Paper account equity"
          value={formatMoney(equity, currency)}
        />
        <Metric
          label="Today’s profit or loss"
          tip="Combined paper P/L for today"
          value={
            dailyPnL == null
              ? "—"
              : `${dailyPnL < 0 ? "-" : ""}$${Math.abs(dailyPnL).toFixed(2)}`
          }
          valueClass={pnlClass(dailyPnL)}
        />
        <Metric
          label="Open positions"
          tip="How many paper positions are open"
          value={String(openCount)}
        />
        <Metric
          label="Auto trading"
          tip="Whether automation may submit paper orders"
          value={autoOn ? "On" : "Off"}
          valueClass={autoOn ? "text-emerald-300" : "text-zinc-100"}
        />
        <Metric
          label="Market"
          tip="Regular US market session"
          value={
            (auto?.trader?.marketOpen ?? marketOpen) == null
              ? "—"
              : (auto?.trader?.marketOpen ?? marketOpen)
                ? "Open"
                : "Closed"
          }
        />
      </dl>

      <AutoTradingActivity
        input={runtimeInput}
        opportunitiesFound={monitor?.opportunitiesFound ?? null}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Status" className="shadow-sm shadow-black/20">
            <div
              className={`rounded-[var(--radius-sm)] border px-4 py-3 ${toneClasses(status.tone)}`}
              role="status"
            >
              <p className="text-lg font-semibold tracking-tight">
                {status.message}
              </p>
              <p className="mt-1 text-sm opacity-90">{status.detail}</p>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Updated {formatTime(stream.heartbeatAt ?? loadedAt)}
              {runtimeInput.monitorScanning
                ? " · Scan in progress"
                : runtimeInput.monitorRunning
                  ? " · Monitor running"
                  : ""}
            </p>
          </Panel>

          <Panel title="Current position">
            {primary ? (
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-2xl font-semibold tracking-tight">
                    {primary.symbol}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Qty {primary.qty}
                  </p>
                </div>
                <p
                  className={`text-lg font-semibold ${pnlClass(primary.unrealizedPl)}`}
                >
                  {primary.unrealizedPl == null
                    ? "—"
                    : `${primary.unrealizedPl < 0 ? "-" : ""}$${Math.abs(primary.unrealizedPl).toFixed(2)}`}
                </p>
                <Link
                  href="/trade"
                  className="ui-btn border border-[var(--border)] text-sm"
                >
                  Inspect position
                </Link>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No open paper position right now.
              </p>
            )}
          </Panel>

          <ExpandableSection
            title="Today’s activity"
            tip={
              <InfoTip text="Recent paper trading decisions and important events." />
            }
            summary={
              activityFeed.length > 0
                ? `${activityFeed.length} recent decision${activityFeed.length === 1 ? "" : "s"}`
                : "No recent activity yet."
            }
          >
            {activityFeed.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No recent decisions yet.</p>
            ) : (
              <ul className="space-y-2">
                {activityFeed.map((d) => (
                  <li
                    key={d.id}
                    className="border-b border-[var(--border)]/70 pb-2 text-sm last:border-0"
                  >
                    <p className="font-medium text-zinc-100">
                      {d.symbol} · {d.status}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {d.reason.slice(0, 120)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {formatTime(d.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ExpandableSection>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Panel title="Quick actions">
            <div className="flex flex-col gap-2">
              <Link
                href="/auto-trade"
                className="ui-btn w-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-50"
              >
                {autoOn ? "Manage auto trading" : "Start auto trading"}
              </Link>
              <Link
                href="/monitor"
                className="ui-btn w-full border border-[var(--border)]"
              >
                Run scan now
              </Link>
              {(topOpp ?? best) ? (
                <Link
                  href={`/trade?symbol=${encodeURIComponent((topOpp ?? best)!.symbol)}`}
                  className="ui-btn w-full border border-amber-500/40 bg-amber-500/12 text-amber-50"
                >
                  Review {(topOpp ?? best)!.symbol}
                </Link>
              ) : null}
              {primary ? (
                <Link
                  href="/trade"
                  className="ui-btn w-full border border-[var(--border)]"
                >
                  Inspect open position
                </Link>
              ) : null}
            </div>
          </Panel>

          <Panel title="Current opportunity">
            {opportunity && (topOpp || best) ? (
              <div className="space-y-2 text-sm">
                <p className="text-xl font-semibold tracking-tight">
                  {(topOpp ?? best)!.symbol}
                </p>
                <p className="text-[var(--muted)]">
                  {(
                    (topOpp?.confidence ?? best?.confidence ?? 0) * 100
                  ).toFixed(0)}
                  % confidence · {(topOpp?.action ?? best?.action) ?? "—"}
                </p>
                <StatusReason
                  reason={`${opportunity.headline}. ${opportunity.detail}`}
                  technical={opportunity.technical}
                />
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No strong opportunity yet. Run a scan when the market is open.
              </p>
            )}
          </Panel>

          <ExpandableSection
            title="Risk protection"
            tip={
              <InfoTip text="Daily trade and account protection limits from auto trading." />
            }
            summary={
              auto?.maxDailyTrades != null
                ? `${auto.dailyTradesUsed ?? 0} of ${auto.maxDailyTrades} daily trades used`
                : "Daily limits and paper-trading protections."
            }
          >
            <ul className="space-y-1 text-sm text-zinc-300">
              <li>
                Daily trades used: {auto?.dailyTradesUsed ?? "—"}
                {auto?.maxDailyTrades != null ? ` of ${auto.maxDailyTrades}` : ""}
              </li>
              <li>Paper trading only — live orders stay blocked.</li>
              <li>
                Trade execution: {executionOn ? "On" : "Off"} · Auto trading:{" "}
                {autoOn ? "On" : "Off"}
              </li>
            </ul>
          </ExpandableSection>
        </aside>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tip,
  valueClass = "text-zinc-100",
}: {
  label: string;
  value: string;
  tip: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 shadow-sm shadow-black/10">
      <dt className="text-xs text-[var(--muted)]">
        {label}
        <InfoTip text={tip} />
      </dt>
      <dd className={`mt-1 text-base font-semibold tabular-nums ${valueClass}`}>
        {value}
      </dd>
    </div>
  );
}
