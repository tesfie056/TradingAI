"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";

export function CompactPositionCard({
  symbol,
  qtyLabel,
  pnlLabel,
  pnlClass = "text-zinc-100",
  marketValueLabel,
  protectionLabel,
  protectionTone = "neutral",
  detailsHref = "/trade",
  onManage,
  manageLabel = "Manage",
  expandedDetails,
  advancedDetails,
}: {
  symbol: string;
  qtyLabel: string;
  pnlLabel: string;
  pnlClass?: string;
  marketValueLabel?: string;
  protectionLabel: string;
  protectionTone?: "ok" | "warn" | "neutral";
  detailsHref?: string;
  onManage?: () => void;
  manageLabel?: string;
  expandedDetails?: ReactNode;
  advancedDetails?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const protectClass =
    protectionTone === "ok"
      ? "text-emerald-300"
      : protectionTone === "warn"
        ? "text-amber-200"
        : "text-zinc-300";

  return (
    <li className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/40 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xl font-semibold tracking-tight">{symbol}</p>
          <p className="mt-0.5 text-sm text-[var(--muted)]">{qtyLabel}</p>
          {marketValueLabel ? (
            <p className="mt-0.5 text-sm text-zinc-300">{marketValueLabel}</p>
          ) : null}
          <p className={`mt-1 text-sm ${protectClass}`}>
            Protection: {protectionLabel}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className={`text-lg font-semibold tabular-nums ${pnlClass}`}>
            {pnlLabel}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {onManage ? (
              <button
                type="button"
                className="ui-btn border border-amber-500/40 bg-amber-500/12 px-2.5 py-1 text-xs text-amber-50"
                onClick={onManage}
              >
                {manageLabel}
              </button>
            ) : null}
            {expandedDetails ? (
              <button
                type="button"
                className="ui-btn border border-[var(--border)] px-2.5 py-1 text-xs"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                {open ? "Hide details" : "Details"}
              </button>
            ) : !onManage ? (
              <Link
                href={detailsHref}
                className="ui-btn border border-[var(--border)] px-2.5 py-1 text-xs"
              >
                View position
              </Link>
            ) : null}
          </div>
        </div>
      </div>
      {open && expandedDetails ? (
        <div className="mt-3 border-t border-[var(--border)]/70 pt-3 text-sm">
          {expandedDetails}
          {advancedDetails}
        </div>
      ) : null}
    </li>
  );
}
