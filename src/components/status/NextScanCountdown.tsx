"use client";

import { formatCountdown } from "@/lib/client/runtime-status-mapper";

export function NextScanCountdown({
  nextScanAt,
  nowMs = Date.now(),
}: {
  nextScanAt: string | null | undefined;
  nowMs?: number;
}) {
  const label = formatCountdown(nextScanAt, nowMs);
  if (!label) {
    return (
      <span className="text-[var(--muted)]">
        Waiting for the monitor’s next scan
      </span>
    );
  }
  return <span className="tabular-nums">Next scan in {label}</span>;
}
