"use client";

import { useState } from "react";
import { AutoTradeInfoTip } from "@/components/auto-trade/AutoTradeInfoTip";
import { formatTime } from "@/lib/format";
import {
  friendlyUniverseReason,
  marketDataStatusLabel,
} from "@/lib/auto-trade/operator-blockers";
import type { TraderDashboardSnapshot } from "@/lib/auto-trade/types";

type Universe = NonNullable<TraderDashboardSnapshot["universe"]>;

export function V1UniversePanel({ universe }: { universe: Universe | null }) {
  const [open, setOpen] = useState(false);

  if (!universe) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-100">Watchlist status</h3>
        <p className="text-sm text-[var(--muted)]">
          No eligible symbols data yet. Run a scan to validate the watchlist.
        </p>
      </div>
    );
  }

  const eligible =
    universe.symbols?.filter((s) => s.status === "eligible") ??
    universe.eligibleSymbols.map((symbol) => ({
      symbol,
      name: null as string | null,
      status: "eligible" as const,
      price: null as number | null,
      userReason: null as string | null,
    }));
  const ineligible =
    universe.symbols?.filter((s) => s.status === "ineligible") ??
    universe.ineligibleSymbols.map((symbol) => ({
      symbol,
      name: null as string | null,
      status: "ineligible" as const,
      price: null as number | null,
      userReason: null as string | null,
    }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">Watchlist status</h3>
        <span className="text-xs text-[var(--muted)]">
          Eligible watchlist
          <AutoTradeInfoTip text="Symbols that currently pass Version 1 price, liquidity, and spread filters." />
        </span>
      </div>

      <ul className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          Configured symbols:{" "}
          <strong className="text-zinc-100">{universe.watchlistSize}</strong>
        </li>
        <li>
          Eligible:{" "}
          <strong className="text-emerald-300">{universe.eligibleCount}</strong>
        </li>
        <li>
          Ineligible:{" "}
          <strong className="text-zinc-100">{universe.ineligibleCount}</strong>
        </li>
        <li>
          Last validation:{" "}
          <strong className="text-zinc-100">
            {universe.evaluatedAt ? formatTime(universe.evaluatedAt) : "—"}
          </strong>
        </li>
        <li>
          Market data:{" "}
          <strong className="text-zinc-100">
            {marketDataStatusLabel(universe.dataFreshness)}
          </strong>
        </li>
      </ul>

      {universe.eligibleCount === 0 ? (
        <p className="text-sm text-amber-200">
          No eligible symbols — Auto Trading cannot be turned on until at least
          one symbol passes Version 1 filters.
        </p>
      ) : null}

      <button
        type="button"
        className="ui-btn border border-[var(--border)] text-sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide symbol details" : "Show symbol details"}
      </button>

      {open ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th scope="col" className="py-1.5 pr-3">
                  Symbol
                </th>
                <th scope="col" className="py-1.5 pr-3">
                  Status
                </th>
                <th scope="col" className="py-1.5">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {eligible.map((row) => (
                <tr key={`e-${row.symbol}`} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3 font-medium text-zinc-100">
                    {row.symbol}
                  </td>
                  <td className="py-2 pr-3 text-emerald-300">Eligible</td>
                  <td className="py-2 text-[var(--muted)]">Ready for Version 1 scans</td>
                </tr>
              ))}
              {ineligible.map((row) => (
                <tr key={`i-${row.symbol}`} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3 font-medium text-zinc-100">
                    {row.symbol}
                  </td>
                  <td className="py-2 pr-3 text-amber-200">Ineligible</td>
                  <td className="py-2 text-[var(--muted)]">
                    {friendlyUniverseReason(
                      row.userReason ?? "Did not meet Version 1 filters",
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          Eligible:{" "}
          {eligible.length
            ? eligible
                .slice(0, 12)
                .map((s) => s.symbol)
                .join(", ")
            : "—"}
          {eligible.length > 12 ? "…" : ""}
        </p>
      )}
    </div>
  );
}
