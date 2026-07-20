"use client";

import Link from "next/link";

export type AttentionPosition = {
  symbol: string;
  unrealizedPl: number | null;
  reason?: string;
};

function pnlLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "P/L unavailable";
  if (n === 0) return "Flat $0.00";
  const abs = Math.abs(n).toFixed(2);
  return n < 0 ? `Down $${abs}` : `Up $${abs}`;
}

function pnlClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-zinc-200";
  return n < 0 ? "text-red-300" : "text-emerald-300";
}

export function PositionsNeedingAttention({
  positions,
  legacyCount = 0,
}: {
  positions: AttentionPosition[];
  /** Small cue when legacy/external positions exist (details in Advanced). */
  legacyCount?: number;
}) {
  if (positions.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-emerald-200/90">
          All open positions are protected.
        </p>
        {legacyCount > 0 ? (
          <p className="text-xs text-amber-200/90">
            {legacyCount} legacy or external position
            {legacyCount === 1 ? "" : "s"} noted in Advanced details.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section
      aria-label="Positions needing attention"
      className="rounded-[var(--radius)] border border-amber-500/30 bg-amber-500/5 px-3 py-3"
    >
      <h2 className="text-sm font-semibold text-zinc-100">
        Positions needing attention
      </h2>
      <ul className="mt-2 space-y-2">
        {positions.map((p) => (
          <li
            key={p.symbol}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border)]/70 bg-[var(--panel)]/70 px-3 py-2 sm:flex-nowrap"
          >
            <div className="min-w-0">
              <p className="font-semibold text-zinc-50">{p.symbol}</p>
              <p className={`text-sm tabular-nums ${pnlClass(p.unrealizedPl)}`}>
                {pnlLabel(p.unrealizedPl)}
              </p>
              <p className="text-xs text-amber-200">Protection missing</p>
            </div>
            <Link
              href={`/trade?symbol=${encodeURIComponent(p.symbol)}`}
              className="ui-btn border border-amber-500/40 bg-amber-500/12 px-3 py-1.5 text-xs text-amber-50"
            >
              Review
            </Link>
          </li>
        ))}
      </ul>
      {legacyCount > 0 ? (
        <p className="mt-2 text-xs text-amber-200/90">
          {legacyCount} legacy or external position
          {legacyCount === 1 ? "" : "s"} noted in Advanced details.
        </p>
      ) : null}
    </section>
  );
}
