"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/Panel";

export type ExternalPositionRow = {
  symbol: string;
  qty: number;
  marketValue: number | null;
  unrealizedPl: number | null;
};

function isLegacyAaplShort(p: ExternalPositionRow): boolean {
  return p.symbol.toUpperCase() === "AAPL" && p.qty < 0;
}

export function ExternalPositionsWarning({
  positions,
  managedSymbols,
  orphanedSymbols = [],
}: {
  positions: ExternalPositionRow[];
  managedSymbols: string[];
  orphanedSymbols?: string[];
}) {
  const managed = new Set(managedSymbols.map((s) => s.toUpperCase()));
  const external = positions.filter((p) => {
    const sym = p.symbol.toUpperCase();
    if (isLegacyAaplShort(p)) return true;
    if (orphanedSymbols.map((s) => s.toUpperCase()).includes(sym)) return true;
    if (!managed.has(sym)) return true;
    return false;
  });

  if (external.length === 0) return null;

  const aapl = external.find(isLegacyAaplShort);

  return (
    <Panel
      title="Legacy or external positions"
      className="border-amber-500/35 bg-amber-500/5"
    >
      <p className="mb-3 text-sm text-amber-100/90">
        These positions are outside Version 1 management. Version 1 will not
        manage or close them automatically.
      </p>
      <ul className="space-y-3">
        {external.map((p) => {
          const legacy = isLegacyAaplShort(p);
          const short = p.qty < 0;
          return (
            <li
              key={`${p.symbol}-${p.qty}`}
              className="rounded-[var(--radius-sm)] border border-amber-500/30 bg-[var(--panel)]/80 px-3 py-3 text-sm"
            >
              <p className="font-semibold text-zinc-50">
                {p.symbol}{" "}
                <span className="font-normal text-amber-100">
                  {short ? "Short position" : "Long position"}
                </span>
              </p>
              <ul className="mt-2 space-y-1 text-zinc-300">
                <li>
                  Ownership:{" "}
                  <strong className="text-zinc-100">
                    {legacy
                      ? "Legacy / external to Version 1"
                      : orphanedSymbols.includes(p.symbol)
                        ? "Orphaned / unknown"
                        : "External to Version 1"}
                  </strong>
                </li>
                {legacy ? (
                  <>
                    <li>Version 1 will not manage or close it</li>
                    <li>AAPL entries are blocked while this position exists</li>
                    <li>Operator action may be required</li>
                  </>
                ) : (
                  <li>Operator action may be required</li>
                )}
              </ul>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link
          href="/trade"
          className="text-amber-100 underline decoration-amber-500/50 underline-offset-2 hover:text-amber-50"
        >
          Open position management
        </Link>
        <span className="text-[var(--muted)]">
          Use Safety Actions → Close All Positions only when you intend to
          liquidate paper positions deliberately.
        </span>
      </div>
      {/* Keep AAPL legacy messaging discoverable for verification */}
      {aapl ? (
        <p className="sr-only">
          AAPL short is legacy external to Version 1 and will not be managed.
        </p>
      ) : null}
    </Panel>
  );
}
