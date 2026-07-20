"use client";

import { Fragment, useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
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
  mandatoryFailed: string[];
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
    marketOpen: boolean | null;
    strategyId: string;
    strategyVersion: string;
    counts: { buy: number; watch: number; skip: number; hold: number };
    results: V1Row[];
  } | null;
};

function decisionTone(d: string): string {
  if (d === "BUY") return "text-emerald-300";
  if (d === "WATCH") return "text-sky-300";
  if (d === "SKIP") return "text-amber-200";
  return "text-zinc-300";
}

export function V1StrategyDecisionsPanel() {
  const [data, setData] = useState<LatestPayload["latest"]>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetchJson<LatestPayload>("/api/auto-trade/v1-strategy");
        if (cancelled) return;
        setData(res.latest);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load strategy");
      }
    }

    const startId = window.setTimeout(() => {
      void tick();
    }, 0);
    const intervalId = window.setInterval(() => {
      void tick();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearTimeout(startId);
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <Panel title="Version 1 strategy decisions">
      <p className="mb-3 text-xs text-zinc-500">
        Deterministic long-only entry rules · planning only · no orders
        submitted
      </p>
      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : !data ? (
        <p className="text-sm text-zinc-500">
          No strategy scan yet. Run the monitor or{" "}
          <code className="text-zinc-400">npm run inspect:v1-strategy</code>.
        </p>
      ) : (
        <>
          <ul className="mb-3 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-4">
            <li>
              Strategy:{" "}
              <strong className="text-zinc-100">
                {data.strategyId} {data.strategyVersion}
              </strong>
            </li>
            <li>
              Last checked:{" "}
              <strong className="text-zinc-100">
                {formatTime(data.evaluatedAt)}
              </strong>
            </li>
            <li>
              BUY / WATCH:{" "}
              <strong className="text-emerald-300">{data.counts.buy}</strong>
              {" / "}
              <strong className="text-sky-300">{data.counts.watch}</strong>
            </li>
            <li>
              SKIP / HOLD:{" "}
              <strong className="text-amber-200">{data.counts.skip}</strong>
              {" / "}
              <strong className="text-zinc-100">{data.counts.hold}</strong>
            </li>
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1.5 pr-3">Symbol</th>
                  <th className="py-1.5 pr-3">Decision</th>
                  <th className="py-1.5 pr-3">Score</th>
                  <th className="py-1.5 pr-3">Price</th>
                  <th className="py-1.5 pr-3">Entry / SL / TP</th>
                  <th className="py-1.5">Main reason</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((row) => {
                  const open = expanded === row.symbol;
                  const passed = row.conditions.filter((c) => c.passed).length;
                  const failed = row.conditions.filter((c) => !c.passed).length;
                  return (
                    <Fragment key={row.symbol}>
                      <tr
                        className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-900/60"
                        onClick={() => setExpanded(open ? null : row.symbol)}
                      >
                        <td className="py-2 pr-3 font-medium text-zinc-100">
                          {row.symbol}
                        </td>
                        <td
                          className={`py-2 pr-3 font-semibold ${decisionTone(row.decision)}`}
                        >
                          {row.decision}
                        </td>
                        <td className="py-2 pr-3 text-zinc-300">
                          {(row.score * 100).toFixed(0)}%
                          <span className="ml-1 text-xs text-zinc-500">
                            conf {(row.confidence * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-zinc-300">
                          {row.latestPrice != null
                            ? `$${row.latestPrice.toFixed(2)}`
                            : "—"}
                        </td>
                        <td className="py-2 pr-3 text-xs text-zinc-400">
                          {row.suggestedEntry != null
                            ? `$${row.suggestedEntry.toFixed(2)}`
                            : "—"}
                          {" / "}
                          {row.suggestedStopLoss != null
                            ? `$${row.suggestedStopLoss.toFixed(2)}`
                            : "—"}
                          {" / "}
                          {row.suggestedTakeProfit != null
                            ? `$${row.suggestedTakeProfit.toFixed(2)}`
                            : "—"}
                          {row.rewardToRisk != null
                            ? ` · R:R ${row.rewardToRisk}`
                            : ""}
                        </td>
                        <td className="py-2 text-zinc-400">
                          {row.primaryReasons[0] ?? row.explanation}
                          <span className="ml-2 text-xs text-zinc-600">
                            {open ? "▾" : "▸"} {passed} pass / {failed} fail
                          </span>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-t border-zinc-900 bg-zinc-950/50">
                          <td
                            colSpan={6}
                            className="px-3 py-3 text-xs text-zinc-400"
                          >
                            <p className="mb-2 text-zinc-300">
                              Conditions · strategy {row.strategyVersion} ·{" "}
                              {formatTime(row.evaluatedAt)}
                            </p>
                            <ul className="grid gap-1 sm:grid-cols-2">
                              {row.conditions.map((c) => (
                                <li key={c.id}>
                                  <span
                                    className={
                                      c.passed
                                        ? "text-emerald-400"
                                        : "text-amber-300"
                                    }
                                  >
                                    {c.passed ? "Pass" : "Fail"}
                                  </span>
                                  {c.mandatory ? " · required" : " · optional"}
                                  {" — "}
                                  <span className="text-zinc-200">{c.name}</span>
                                  : {c.explanation}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
