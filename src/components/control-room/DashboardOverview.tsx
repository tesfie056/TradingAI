"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { PageHeader, PageLinkButton } from "@/components/layout/PageHeader";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { Panel } from "@/components/ui/Panel";
import { ActionBadge, ConfidenceBar } from "@/components/ui/badges";
import { PaperOnlyBanner } from "@/components/ui/PaperOnlyBanner";
import { SafetyStrip, StatusDot } from "@/components/ui/SafetyStrip";
import { fetchJson } from "@/lib/client/fetch-json";
import { aiStatusDisplayLabel } from "@/lib/client/block-reasons";
import { formatMoney, formatTime } from "@/lib/format";
import { topSignalHeadline } from "@/lib/monitor/display";
import type { MonitorStatus } from "@/lib/monitor/types";
import type { AiDecision, MarketClockStatus } from "@/lib/alpaca/types";
import type {
  AccountPayload,
  AiHealthPayload,
} from "@/lib/dashboard-types";
import type { MarketCondition } from "@/lib/stocks/market-condition";

const QUICK_LINKS = [
  {
    href: "/monitor",
    title: "Monitor",
    text: "Scan for paper-trade setups without placing orders.",
  },
  {
    href: "/watchlist",
    title: "Watchlist",
    text: "Review AI decisions and prepare a paper trade.",
  },
  {
    href: "/trade",
    title: "Trade",
    text: "Preview and manually approve paper orders.",
  },
  {
    href: "/performance",
    title: "Performance",
    text: "See how past decisions would have fared.",
  },
  {
    href: "/backtest",
    title: "Backtest",
    text: "Replay strategy rules on historical bars.",
  },
  {
    href: "/assistant",
    title: "Assistant",
    text: "Ask the desk AI — it never places orders.",
  },
  {
    href: "/settings",
    title: "Settings",
    text: "Defaults, watchlist prefs, and view mode.",
  },
  {
    href: "/logs",
    title: "Logs",
    text: "Decisions, blocks, monitor events, and AI history.",
  },
] as const;

export function DashboardOverview({
  account,
  currency,
  clock,
  marketCondition,
  orderExecutionEnabled,
  decisions,
  aiHealth,
  simple,
  loadedAt,
  error,
  refresh,
  isPending,
  refreshAiHealth,
  aiHealthBusy,
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
  const best = [...decisions].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
  )[0];
  const tradable = decisions.filter((d) => d.readyForManualPaperTrade).length;

  const [monitor, setMonitor] = useState<MonitorStatus | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchJson<MonitorStatus>("/api/monitor");
        if (!cancelled) {
          setMonitor(next);
          setMonitorError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setMonitorError(
            err instanceof Error ? err.message : "Monitor unavailable",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadedAt]);

  const aiLabel = aiStatusDisplayLabel(aiHealth?.statusLabel);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="A calm paper-trading desk for U.S. stocks. AI can explain and suggest — you always confirm."
        actions={
          <>
            <PageLinkButton href="/assistant" tone="accent">
              Ask AI
            </PageLinkButton>
            <PageLinkButton href="/watchlist">Watchlist</PageLinkButton>
            <PageLinkButton href="/monitor">Monitor</PageLinkButton>
            <PageLinkButton href="/trade">Trade</PageLinkButton>
          </>
        }
      />

      <SafetyBanner orderExecutionEnabled={orderExecutionEnabled} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PaperOnlyBanner detail="manual approval required · stocks only" />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={isPending}
            className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--foreground)] disabled:opacity-50"
          >
            {isPending ? "Refreshing…" : "Refresh"}
          </button>
          <p className="text-sm text-[var(--muted)]">
            Updated {formatTime(loadedAt)}
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-sm)] border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-base text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          label="Account equity"
          value={formatMoney(account?.account.equity, currency)}
        />
        <SummaryCard
          label="Cash"
          value={formatMoney(account?.account.cash, currency)}
        />
        <SummaryCard
          label="Buying power"
          value={formatMoney(account?.account.buyingPower, currency)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatusCard
          label="Market"
          value={
            marketOpen == null ? "—" : marketOpen ? "Open" : "Closed"
          }
          hint={
            marketCondition
              ? `${marketCondition.label} · score ${(marketCondition.marketScore * 100).toFixed(0)}%`
              : undefined
          }
          tone={marketOpen === false ? "warn" : marketOpen ? "ok" : "neutral"}
        />
        <StatusCard
          label="AI status"
          value={aiLabel}
          hint={
            aiHealth?.ollama.message
              ? `${aiHealth.ollama.message}${
                  aiHealth.ollama.latencyMs != null
                    ? ` · ${aiHealth.ollama.latencyMs}ms`
                    : ""
                }`
              : undefined
          }
          tone={aiHealth?.statusLabel === "connected" ? "ok" : "warn"}
          action={
            <button
              type="button"
              onClick={refreshAiHealth}
              disabled={aiHealthBusy}
              className="text-sm text-amber-100 underline-offset-2 hover:underline disabled:opacity-50"
            >
              {aiHealthBusy ? "Checking…" : "Check AI"}
            </button>
          }
        />
        <StatusCard
          label="Order execution"
          value={orderExecutionEnabled ? "ON" : "OFF"}
          hint="Paper submits stay locked when OFF"
          tone={orderExecutionEnabled ? "warn" : "neutral"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top signal">
          {best ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl font-semibold tracking-tight">
                  {best.symbol}
                </span>
                <ActionBadge action={best.action} />
              </div>
              <ConfidenceBar value={best.confidence} />
              <p className="text-base leading-relaxed text-[var(--foreground)]/90">
                {simple
                  ? (best.explanation?.summary ??
                    best.reasons[0] ??
                    "No summary yet.")
                  : (best.explanation?.summary ??
                    best.reasons.slice(0, 2).join(" "))}
              </p>
              <p className="text-sm text-[var(--muted)]">
                {tradable} ready to preview · {decisions.length} on watchlist
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/monitor"
                  className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] text-sm"
                >
                  Open Monitor
                </Link>
                <Link
                  href={`/trade?symbol=${encodeURIComponent(best.symbol)}`}
                  className="ui-btn border border-amber-500/40 bg-amber-500/12 text-sm text-amber-50"
                >
                  Open Trade
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-base text-[var(--muted)]">
              Refresh the desk to load decisions.
            </p>
          )}
        </Panel>

        <Panel title="Monitor status">
          {monitorError ? (
            <p className="text-base text-amber-100/90">{monitorError}</p>
          ) : monitor ? (
            <div className="flex flex-col gap-3 text-base">
              <div className="flex flex-wrap items-center gap-2">
                <StatusDot
                  tone={
                    monitor.status === "running"
                      ? "ok"
                      : monitor.status === "scanning"
                        ? "warn"
                        : "neutral"
                  }
                />
                <span className="font-semibold capitalize">{monitor.status}</span>
                <span className="text-sm text-[var(--muted)]">
                  Last scan {formatTime(monitor.lastScanAt)}
                </span>
              </div>
              <p className="leading-relaxed text-[var(--foreground)]/90">
                {monitor.topOpportunity
                  ? topSignalHeadline(monitor.topOpportunity)
                  : "No active top signal yet."}
              </p>
              <p className="text-sm text-[var(--muted)]">
                {monitor.activeOpportunities} active ·{" "}
                {monitor.opportunitiesFound} found last cycle
              </p>
              <Link
                href="/monitor"
                className="ui-btn w-fit border border-[var(--border)] bg-[var(--panel-elevated)] text-sm"
              >
                Open Monitor
              </Link>
            </div>
          ) : (
            <p className="text-base text-[var(--muted)]">Loading monitor…</p>
          )}
        </Panel>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Quick links</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="ui-card flex flex-col gap-2 transition hover:border-amber-500/35"
            >
              <span className="text-lg font-semibold">{item.title}</span>
              <p className="flex-1 text-sm leading-relaxed text-[var(--muted)]">
                {item.text}
              </p>
              <span className="text-sm font-medium text-amber-100/90">
                Open page →
              </span>
            </Link>
          ))}
        </div>
      </div>

      <SafetyStrip orderExecutionEnabled={orderExecutionEnabled} compact />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="ui-card">
      <div className="text-sm text-[var(--muted)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}

function StatusCard({
  label,
  value,
  hint,
  tone = "neutral",
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "neutral";
  action?: ReactNode;
}) {
  return (
    <div className="ui-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <StatusDot tone={tone} />
          {label}
        </div>
        {action}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight">{value}</div>
      {hint ? (
        <p className="mt-1 text-sm capitalize text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
