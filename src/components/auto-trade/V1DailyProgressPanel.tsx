"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatRemainingToGoal } from "@/lib/auto-trade/operator-blockers";

type FailureReason = { code: string; message: string };

type DailyStatus = {
  ok?: boolean;
  targetLabel: string;
  explanation: string;
  config: {
    dailyCompletedTradeTarget: number;
    maxTradesPerDay: number;
    warnings: { code: string; message: string }[];
  };
  session: {
    tradingDate: string;
    status: string;
    completed: number;
    remaining: number;
    target: number;
    targetReached: boolean;
    wins: number;
    losses: number;
    breakeven: number;
    realizedNetPnL: number;
    openTrades: number;
    pendingEntries: number;
    pendingExits: number;
    maxTradesReached: boolean;
    tradingPaused: boolean;
    pauseReason: string | null;
    failureReasons: FailureReason[];
    configurationWarnings: string[];
  };
};

const SAFETY_EXPLANATION =
  "The daily goal never overrides safety rules. The system may complete fewer than three trades when no qualified setup is available.";

export function V1DailyProgressPanel({
  executionOff,
  autoOff,
}: {
  executionOff?: boolean;
  autoOff?: boolean;
}) {
  const [data, setData] = useState<DailyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetchJson<DailyStatus>("/api/auto-trade/daily-status");
        if (cancelled) return;
        setData(res);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load daily status");
      }
    }
    const startId = window.setTimeout(() => void tick(), 0);
    const intervalId = window.setInterval(() => void tick(), 45_000);
    return () => {
      cancelled = true;
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, []);

  const completed = data?.session.completed ?? 0;
  const target = data?.session.target ?? 3;
  const pct = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;

  return (
    <Panel
      title="Daily progress"
      action={
        <span className="text-xs text-[var(--muted)]">
          Daily goal
          <AutoTradeInfoTip text="Completed Version 1 round trips today. Progress only — never forces trades." />
        </span>
      }
    >
      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : !data ? (
        <p className="text-sm text-[var(--muted)]">Loading daily progress…</p>
      ) : (
        <>
          <p className="mb-1 text-base font-medium text-zinc-100">
            Daily goal: {completed} of {target} completed trades
          </p>
          <p className="mb-2 text-sm text-zinc-300">
            {formatRemainingToGoal(data.session.remaining)}
          </p>

          <div
            className="mb-3 h-2.5 overflow-hidden rounded-full bg-zinc-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={completed}
            aria-valuetext={`${completed} of ${target} completed trades`}
          >
            <div
              className="h-full rounded-full bg-emerald-500/80 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>

          <p className="mb-3 text-xs text-[var(--muted)]">{SAFETY_EXPLANATION}</p>
          <p className="mb-3 text-xs text-[var(--muted)]">{data.explanation}</p>

          {(data.config.warnings.length > 0 ||
            data.session.configurationWarnings.length > 0 ||
            executionOff ||
            autoOff) && (
            <ul className="mb-3 space-y-1 text-sm text-amber-200">
              {executionOff ? <li>Paper execution is disabled — no new entries.</li> : null}
              {autoOff ? <li>Auto Trading is disabled — no automatic submissions.</li> : null}
              {data.config.warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
              {data.session.configurationWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          <ul className="mb-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-4">
            <li>
              Wins:{" "}
              <strong className="text-emerald-300">{data.session.wins}</strong>
            </li>
            <li>
              Losses:{" "}
              <strong className="text-amber-200">{data.session.losses}</strong>
            </li>
            <li>
              Breakeven:{" "}
              <strong className="text-zinc-100">{data.session.breakeven}</strong>
            </li>
            <li>
              Realized P/L:{" "}
              <strong
                className={
                  data.session.realizedNetPnL >= 0
                    ? "text-emerald-300"
                    : "text-amber-200"
                }
              >
                ${data.session.realizedNetPnL.toFixed(2)}
              </strong>
            </li>
            <li>
              Open managed trades:{" "}
              <strong className="text-zinc-100">{data.session.openTrades}</strong>
            </li>
            <li>
              Pending entries:{" "}
              <strong className="text-sky-300">{data.session.pendingEntries}</strong>
            </li>
            <li>
              Pending exits:{" "}
              <strong className="text-sky-300">{data.session.pendingExits}</strong>
            </li>
            <li>
              Target:{" "}
              <strong
                className={
                  data.session.targetReached ? "text-emerald-300" : "text-zinc-100"
                }
              >
                {data.session.targetReached ? "Reached" : "In progress"}
              </strong>
            </li>
            <li>
              Trading paused:{" "}
              <strong className="text-zinc-100">
                {data.session.tradingPaused ? "Yes" : "No"}
              </strong>
            </li>
          </ul>

          {data.session.pauseReason ? (
            <p className="mb-2 text-sm text-amber-200">
              Pause reason: {data.session.pauseReason}
            </p>
          ) : null}

          {!data.session.targetReached &&
          data.session.failureReasons.length > 0 ? (
            <div className="mb-1">
              <p className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">
                Why the daily goal is incomplete
              </p>
              <ul className="space-y-1 text-sm text-[var(--muted)]">
                {data.session.failureReasons.slice(0, 8).map((r) => (
                  <li key={r.code}>• {r.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
