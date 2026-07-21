"use client";

import Link from "next/link";
import { InfoTip } from "@/components/ui/InfoTip";

/**
 * Warns when open paper positions lack protective stop-loss / take-profit.
 * Does not close or modify positions — operator action only.
 */

export type UnprotectedPositionItem = {
  symbol: string;
  reason: string;
  qty?: string | number;
};

export function UnprotectedPositionsBanner({
  positions,
  className = "",
}: {
  positions: UnprotectedPositionItem[];
  className?: string;
}) {
  if (positions.length === 0) return null;

  const symbols = positions.map((p) => p.symbol);

  return (
    <div
      role="alert"
      className={`rounded-[var(--radius)] border border-amber-500/45 bg-amber-500/10 px-4 py-3 text-sm text-amber-50 shadow-sm shadow-black/15 ${className}`}
    >
      <p className="flex flex-wrap items-center font-semibold tracking-tight text-amber-50">
        Unprotected positions
        <InfoTip
          label="More information about unprotected positions"
          text="These positions may remain open without automatic loss or profit protection. Review them before enabling new automated trades."
        />
      </p>
      <p className="mt-1.5 text-amber-100/95">
        {positions.length} open position
        {positions.length === 1 ? "" : "s"}{" "}
        {positions.length === 1 ? "is" : "are"} missing stop-loss or take-profit
        protection.
      </p>
      <ul className="mt-2 space-y-0.5">
        {symbols.map((symbol) => (
          <li key={symbol} className="font-medium text-amber-50">
            {symbol}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href="/trade"
          className="ui-btn border border-amber-500/45 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-50"
        >
          Review positions
        </Link>
        <a
          href="#emergency-controls"
          className="ui-btn border border-[var(--border)] px-3 py-1.5 text-xs text-zinc-200"
        >
          Emergency controls
        </a>
      </div>
    </div>
  );
}
