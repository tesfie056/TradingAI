"use client";

import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";
import {
  formatUsd,
  pnlToneClass,
  type PrimaryStatus,
} from "@/lib/auto-trade/primary-status";

export type OverviewPosition = {
  symbol: string;
  qty: number;
  unrealizedPl: number | null;
} | null;

type Props = {
  loading?: boolean;
  primary: PrimaryStatus;
  marketOpen: boolean | null | undefined;
  autoTradingOn: boolean;
  executionOn: boolean;
  equity: number | null | undefined;
  dailyPnL: number | null | undefined;
  openPosition: OverviewPosition;
  dailyTradesUsed: number;
  maxDailyTrades: number;
  staleUpdate?: boolean;
};

function marketLabel(marketOpen: boolean | null | undefined): string {
  if (marketOpen == null) return "Unknown";
  return marketOpen ? "Open" : "Closed";
}

/** Compact status row for the Auto Trading control card. */
export function AutoTradeOverviewCard({
  loading,
  primary: _primary,
  marketOpen,
  autoTradingOn,
  executionOn,
  equity,
  dailyPnL,
  openPosition: _openPosition,
  dailyTradesUsed,
  maxDailyTrades,
  staleUpdate,
}: Props) {
  const tradesLabel =
    maxDailyTrades > 0
      ? `${dailyTradesUsed} of ${maxDailyTrades}`
      : String(dailyTradesUsed);

  if (loading) {
    return (
      <p className="text-sm text-[var(--muted)]" role="status">
        Loading trading status…
      </p>
    );
  }

  return (
    <div aria-label="Trading status" className="border-t border-[var(--border)]/70 pt-3">
      <p className="sr-only">Trading status</p>
      {staleUpdate ? (
        <p className="mb-2 text-xs text-amber-200">
          Updates appear stale — check connection and retry.
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-[var(--muted)]">
            Market
            <AutoTradeInfoTip
              label="More information about market status"
              text="New stock entries wait until the regular U.S. market session opens."
            />
          </dt>
          <dd className="font-medium text-zinc-100">
            {marketLabel(marketOpen)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">
            Paper execution
            <AutoTradeInfoTip
              label="More information about paper execution"
              text="Paper execution allows simulated orders. It does not place real-money trades."
            />
          </dt>
          <dd className="font-medium text-zinc-100">
            {executionOn ? "On" : "Off"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">
            Auto trading
            <AutoTradeInfoTip
              label="More information about auto trading"
              text="Auto trading scans and opens eligible paper trades using the current strategy and safety rules."
            />
          </dt>
          <dd className="font-medium text-zinc-100">
            {autoTradingOn ? "On" : "Off"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">
            Trades today
            <AutoTradeInfoTip
              label="More information about trades today"
              text={
                maxDailyTrades > 0
                  ? `The current safety limit allows up to ${maxDailyTrades} new paper trades today.`
                  : "Daily paper trade limits protect the account under the current safety rules."
              }
            />
          </dt>
          <dd className="font-medium text-zinc-100">{tradesLabel}</dd>
        </div>
      </dl>
      <p className="sr-only">
        Account value {formatUsd(equity)}. Today&apos;s profit or loss{" "}
        <span className={pnlToneClass(dailyPnL)}>{formatUsd(dailyPnL)}</span>.
        Daily trades used {tradesLabel}.
      </p>
    </div>
  );
}
