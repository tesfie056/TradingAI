"use client";

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

  return (
    <div
      role="alert"
      className={`rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 shadow-sm ${className}`}
    >
      <p className="font-semibold text-amber-50">
        Unprotected open position
        {positions.length === 1 ? "" : "s"} — no stop-loss / take-profit
      </p>
      <p className="mt-1 text-amber-100/90">
        Emergency Stop blocks new orders and cancels pending entries, but it
        does <strong className="font-semibold text-amber-50">not</strong> close
        these positions. Use{" "}
        <strong className="font-semibold text-amber-50">
          Close All Positions
        </strong>{" "}
        only if you intentionally want to flatten, or add protection in the
        Alpaca paper dashboard.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/95">
        {positions.map((p) => (
          <li key={p.symbol}>
            <span className="font-medium text-amber-50">{p.symbol}</span>
            {p.qty != null ? ` · qty ${p.qty}` : ""}
            {p.reason ? ` — ${p.reason}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
