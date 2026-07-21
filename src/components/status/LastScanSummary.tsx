"use client";

import { formatTime } from "@/lib/format";

export function LastScanSummary({
  stocksChecked,
  opportunitiesFound,
  completedAt,
  durationSec,
}: {
  stocksChecked?: number | null;
  opportunitiesFound?: number | null;
  completedAt?: string | null;
  durationSec?: number | null;
}) {
  if (stocksChecked == null && !completedAt) return null;

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)]/80 bg-[var(--panel-elevated)]/40 px-3 py-2 text-xs text-zinc-300">
      <p className="font-medium text-zinc-100">Last scan</p>
      <ul className="mt-1 space-y-0.5">
        {stocksChecked != null ? (
          <li>
            {stocksChecked} stock{stocksChecked === 1 ? "" : "s"} checked
          </li>
        ) : null}
        {opportunitiesFound != null ? (
          <li>
            {opportunitiesFound === 0
              ? "No stocks met all entry rules"
              : `${opportunitiesFound} setup${opportunitiesFound === 1 ? "" : "s"} ready for review`}
          </li>
        ) : null}
        {durationSec != null && Number.isFinite(durationSec) ? (
          <li>Completed in {durationSec.toFixed(1)} seconds</li>
        ) : null}
        {completedAt ? <li>Completed at {formatTime(completedAt)}</li> : null}
      </ul>
    </div>
  );
}
