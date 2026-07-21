"use client";

import { Panel } from "@/components/ui/Panel";
import { ActionBadge, ConfidenceBar } from "@/components/ui/badges";
import { StatusDot } from "@/components/ui/SafetyStrip";
import type { AiDecision } from "@/lib/alpaca/types";
import type { MarketCondition } from "@/lib/stocks/market-condition";
import { formatMoney } from "@/lib/format";

export function DashboardSummary({
  equity,
  cash,
  buyingPower,
  currency,
  marketOpen,
  marketCondition,
  orderExecutionEnabled,
  decisions,
  onAskAi,
  onJumpWatchlist,
  simple,
}: {
  equity?: string | null;
  cash?: string | null;
  buyingPower?: string | null;
  currency: string;
  marketOpen: boolean | null;
  marketCondition: MarketCondition | null;
  orderExecutionEnabled: boolean;
  decisions: AiDecision[];
  onAskAi: () => void;
  onJumpWatchlist: () => void;
  simple: boolean;
}) {
  const best = [...decisions].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
  )[0];
  const tradable = decisions.filter((d) => d.readyForManualPaperTrade).length;
  const blocked = decisions.length - tradable;

  const blockWhy: string[] = [];
  if (marketOpen === false) blockWhy.push("The U.S. market is closed.");
  if (marketOpen === null) {
    blockWhy.push("Market status unavailable — broker clock could not be confirmed.");
  }
  if (!orderExecutionEnabled)
    blockWhy.push("Order execution is OFF (paper submits stay locked).");
  if (blocked > 0 && marketOpen === true)
    blockWhy.push(
      `${blocked} watchlist name${blocked === 1 ? "" : "s"} blocked by risk, data quality, or HOLD.`,
    );
  if (blockWhy.length === 0) {
    blockWhy.push("No global block — check each stock before preparing a trade.");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <h1 className="h1">Dashboard</h1>
          <p className="mt-2 text-base text-[var(--muted)] sm:text-lg">
            A calm paper-trading desk for U.S. stocks. AI can explain and
            suggest — you always confirm.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAskAi}
            className="ui-btn border border-amber-500/45 bg-amber-500/15 text-amber-50"
          >
            Ask AI
          </button>
          <button
            type="button"
            onClick={onJumpWatchlist}
            className="ui-btn border border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--foreground)]"
          >
            View watchlist
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Account equity"
          value={formatMoney(equity, currency)}
        />
        <SummaryCard label="Cash" value={formatMoney(cash, currency)} />
        <SummaryCard
          label="Buying power"
          value={formatMoney(buyingPower, currency)}
        />
        <SummaryCard
          label="Market"
          value={
            marketOpen === true
              ? "Open"
              : marketOpen === false
                ? "Closed"
                : "Unavailable"
          }
          hint={
            marketCondition
              ? `${marketCondition.label} · score ${(marketCondition.marketScore * 100).toFixed(0)}%`
              : undefined
          }
          tone={
            marketOpen === true ? "ok" : marketOpen === false ? "warn" : "warn"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Today's summary" className="lg:col-span-1">
          <ul className="space-y-3 text-base">
            <li className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted)]">Watchlist</span>
              <span className="font-semibold tabular-nums">
                {decisions.length}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted)]">Ready to preview</span>
              <span className="font-semibold tabular-nums text-emerald-300">
                {tradable}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted)]">Blocked</span>
              <span className="font-semibold tabular-nums text-amber-200">
                {blocked}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-[var(--muted)]">Execution</span>
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <StatusDot tone={orderExecutionEnabled ? "warn" : "neutral"} />
                {orderExecutionEnabled ? "ON" : "OFF"}
              </span>
            </li>
          </ul>
        </Panel>

        <Panel title="Best opportunity" className="lg:col-span-1">
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
            </div>
          ) : (
            <p className="text-base text-[var(--muted)]">
              Refresh the desk to load decisions.
            </p>
          )}
        </Panel>

        <Panel title="Why trading is blocked" className="lg:col-span-1">
          <ul className="space-y-2.5 text-base leading-relaxed text-[var(--foreground)]/90">
            {blockWhy.map((line) => (
              <li key={line} className="flex gap-2">
                <StatusDot tone="warn" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-[var(--muted)]">
            AI never places orders. Manual confirmation is always required.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  return (
    <div className="ui-card">
      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <StatusDot tone={tone} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {hint ? (
        <p className="mt-1 text-sm capitalize text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
