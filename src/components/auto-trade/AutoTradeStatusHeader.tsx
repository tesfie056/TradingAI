"use client";

import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";
import { formatTime } from "@/lib/format";
import { marketDataStatusLabel } from "@/lib/auto-trade/operator-blockers";
import {
  V1_STRATEGY_ID,
  V1_STRATEGY_VERSION,
} from "@/lib/strategy/v1-simple-long/config";

export type StatusHeaderProps = {
  autoTradingOn: boolean;
  executionOn: boolean;
  marketOpen: boolean | null | undefined;
  alpacaConnected: boolean;
  dataFreshness: string | null | undefined;
  lastUpdatedAt: string | null;
  staleUpdate: boolean;
  loading?: boolean;
};

function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "ok" | "warn" | "bad" | "neutral" | "info";
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
      : tone === "warn"
        ? "border-amber-500/35 bg-amber-500/10 text-amber-100"
        : tone === "bad"
          ? "border-red-500/35 bg-red-500/10 text-red-100"
          : tone === "info"
            ? "border-sky-500/35 bg-sky-500/10 text-sky-100"
            : "border-[var(--border)] bg-[var(--panel-elevated)] text-zinc-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

export function AutoTradeStatusHeader({
  autoTradingOn,
  executionOn,
  marketOpen,
  alpacaConnected,
  dataFreshness,
  lastUpdatedAt,
  staleUpdate,
  loading,
}: StatusHeaderProps) {
  const dataLabel = marketDataStatusLabel(dataFreshness);
  const marketLabel =
    marketOpen == null ? "Market Unknown" : marketOpen ? "Market Open" : "Market Closed";

  return (
    <Panel title="System status" className="shadow-sm shadow-black/20">
      {loading && !lastUpdatedAt ? (
        <p className="text-sm text-[var(--muted)]" role="status">
          Loading system status…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" aria-label="System status summary">
            <Pill tone="info">Paper Trading</Pill>
            <Pill tone={autoTradingOn ? "ok" : "neutral"}>
              {autoTradingOn ? "Auto Trading On" : "Auto Trading Off"}
            </Pill>
            <Pill tone={executionOn ? "warn" : "neutral"}>
              {executionOn ? "Order Execution On" : "Order Execution Off"}
            </Pill>
            <Pill
              tone={
                marketOpen === true ? "ok" : marketOpen === false ? "neutral" : "warn"
              }
            >
              {marketLabel}
            </Pill>
            <Pill tone={alpacaConnected ? "ok" : "bad"}>
              {alpacaConnected ? "Alpaca Connected" : "Alpaca Disconnected"}
            </Pill>
            <Pill
              tone={
                dataLabel === "Current"
                  ? "ok"
                  : dataLabel === "Stale" || dataLabel === "Unavailable"
                    ? "bad"
                    : "warn"
              }
            >
              Data {dataLabel}
            </Pill>
            <Pill>
              Strategy: {V1_STRATEGY_ID}
              <AutoTradeInfoTip text="Version 1 long-only paper strategy used for scan decisions." />
            </Pill>
            <Pill>Strategy version: {V1_STRATEGY_VERSION}</Pill>
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">
            Last system update:{" "}
            <time dateTime={lastUpdatedAt ?? undefined}>
              {lastUpdatedAt ? formatTime(lastUpdatedAt) : "—"}
            </time>
            {staleUpdate ? (
              <span className="ml-2 text-amber-200" role="status">
                Updates appear stale — check connection and retry.
              </span>
            ) : null}
          </p>
        </>
      )}
    </Panel>
  );
}
