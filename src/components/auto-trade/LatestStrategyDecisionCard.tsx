"use client";

import { useEffect, useState } from "react";
import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";
import { fetchJson } from "@/lib/client/fetch-json";
import { formatTime } from "@/lib/format";

type ConditionDetail = {
  id: string;
  name: string;
  passed: boolean;
  mandatory: boolean;
  explanation: string;
};

type V1Row = {
  symbol: string;
  decision: "BUY" | "WATCH" | "SKIP" | "HOLD";
  score: number;
  confidence: number;
  latestPrice: number | null;
  primaryReasons: string[];
  conditions: ConditionDetail[];
  suggestedEntry: number | null;
  suggestedStopLoss: number | null;
  suggestedTakeProfit: number | null;
  rewardToRisk: number | null;
  strategyVersion: string;
  evaluatedAt: string;
  explanation: string;
};

type LatestPayload = {
  ok?: boolean;
  latest: {
    evaluatedAt: string;
    strategyId: string;
    strategyVersion: string;
    results: V1Row[];
  } | null;
};

const DECISION_LABEL: Record<V1Row["decision"], string> = {
  BUY: "Buy setup",
  WATCH: "Watching",
  SKIP: "Skipped",
  HOLD: "Hold",
};

function decisionClasses(d: V1Row["decision"]): string {
  if (d === "BUY") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
  if (d === "WATCH") return "border-sky-500/40 bg-sky-500/10 text-sky-100";
  if (d === "SKIP") return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  return "border-[var(--border)] bg-[var(--panel-elevated)] text-zinc-200";
}

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export function LatestStrategyDecisionCard({
  onHasBuyChange,
}: {
  onHasBuyChange?: (hasBuy: boolean | null) => void;
}) {
  const [row, setRow] = useState<V1Row | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetchJson<LatestPayload>("/api/auto-trade/v1-strategy");
        if (cancelled) return;
        const results = res.latest?.results ?? [];
        const preferred =
          results.find((r) => r.decision === "BUY") ??
          results.find((r) => r.decision === "WATCH") ??
          results[0] ??
          null;
        setRow(preferred);
        onHasBuyChange?.(
          res.latest == null ? null : results.some((r) => r.decision === "BUY"),
        );
        setError(null);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load decision");
        onHasBuyChange?.(null);
        setLoaded(true);
      }
    }
    const startId = window.setTimeout(() => void tick(), 0);
    const intervalId = window.setInterval(() => void tick(), 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, [onHasBuyChange]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">Latest strategy decision</h3>
        <AutoTradeInfoTip text="The most relevant recent scan result for the Version 1 paper strategy." />
      </div>

      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : !loaded ? (
        <p className="text-sm text-[var(--muted)]">Loading latest decision…</p>
      ) : !row ? (
        <p className="text-sm text-[var(--muted)]">
          No strategy decisions yet. Run a scan to evaluate the watchlist.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-semibold text-zinc-50">{row.symbol}</span>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${decisionClasses(row.decision)}`}
              aria-label={`Decision ${row.decision}`}
            >
              {DECISION_LABEL[row.decision]}
            </span>
          </div>

          <p className="text-sm text-zinc-200">
            {row.primaryReasons[0] ?? row.explanation}
          </p>

          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Setup strength
                <AutoTradeInfoTip text="How strongly the strategy rates this setup." />
              </dt>
              <dd className="font-medium">{(row.score * 100).toFixed(0)}%</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Confidence
                <AutoTradeInfoTip text="How confident the strategy is in this reading." />
              </dt>
              <dd className="font-medium">{(row.confidence * 100).toFixed(0)}%</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Current price</dt>
              <dd className="font-medium">{fmtUsd(row.latestPrice)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Suggested entry</dt>
              <dd className="font-medium">{fmtUsd(row.suggestedEntry)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Suggested stop-loss</dt>
              <dd className="font-medium">{fmtUsd(row.suggestedStopLoss)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Suggested take-profit</dt>
              <dd className="font-medium">{fmtUsd(row.suggestedTakeProfit)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">
                Reward-to-risk
                <AutoTradeInfoTip text="Planned reward divided by planned risk for this setup." />
              </dt>
              <dd className="font-medium">
                {row.rewardToRisk != null ? row.rewardToRisk.toFixed(2) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Evaluated time</dt>
              <dd className="font-medium">{formatTime(row.evaluatedAt)}</dd>
            </div>
          </dl>

          <button
            type="button"
            className="ui-btn border border-[var(--border)] text-sm text-zinc-200 hover:bg-[var(--panel-elevated)]"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide condition details" : "Show condition details"}
          </button>

          {expanded ? (
            <ul className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/50 p-3 text-sm sm:grid-cols-2">
              {row.conditions.map((c) => (
                <li key={c.id}>
                  <span className={c.passed ? "text-emerald-300" : "text-amber-200"}>
                    {c.passed ? "Passed" : "Failed"}
                  </span>
                  {c.mandatory ? " · required" : " · optional"}
                  {" — "}
                  <span className="text-zinc-100">{c.name}</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">
                    {c.explanation}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
