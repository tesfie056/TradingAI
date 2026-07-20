"use client";

import Link from "next/link";
import { formatTime } from "@/lib/format";
import type { AutoTradeDecision, AutoTradeLogEntry } from "@/lib/auto-trade/types";
import { formatSkipReason } from "@/lib/auto-trade/display";

export type ActivityItem = {
  id: string;
  time: string;
  symbol?: string;
  event: string;
  severity: "info" | "ok" | "warn" | "critical";
};

function severityClass(s: ActivityItem["severity"]): string {
  if (s === "ok") return "text-emerald-300";
  if (s === "warn") return "text-amber-200";
  if (s === "critical") return "text-red-300";
  return "text-zinc-300";
}

function severityLabel(s: ActivityItem["severity"]): string {
  if (s === "ok") return "Success";
  if (s === "warn") return "Notice";
  if (s === "critical") return "Important";
  return "Info";
}

export function buildRecentActivity(input: {
  decisions: AutoTradeDecision[];
  logs: AutoTradeLogEntry[];
  limit?: number;
}): ActivityItem[] {
  const limit = input.limit ?? 8;
  const items: ActivityItem[] = [];

  for (const d of input.decisions) {
    const blocked = d.blockers[0];
    let event: string;
    let severity: ActivityItem["severity"] = "info";
    if (d.status === "submitted" || d.status === "filled") {
      event = `Paper ${d.action} ${d.status === "filled" ? "filled" : "submitted"}`;
      severity = "ok";
    } else if (blocked) {
      event = formatSkipReason(blocked.code, blocked.message);
      severity = "warn";
    } else {
      event = d.reason.slice(0, 100) || "Strategy evaluation";
    }
    items.push({
      id: `dec-${d.id}`,
      time: d.createdAt,
      symbol: d.symbol,
      event,
      severity,
    });
  }

  for (const l of input.logs) {
    const msg = l.message.toLowerCase();
    let severity: ActivityItem["severity"] = "info";
    if (msg.includes("emergency") || msg.includes("kill")) severity = "critical";
    else if (msg.includes("block") || msg.includes("pause")) severity = "warn";
    else if (msg.includes("completed") || msg.includes("filled")) severity = "ok";
    items.push({
      id: `log-${l.id}`,
      time: l.timestamp,
      symbol: l.symbol ?? undefined,
      event: l.message,
      severity,
    });
  }

  return items
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, limit);
}

export function RecentAutoTradeActivity({
  items,
  loading,
}: {
  items: ActivityItem[];
  loading?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">Recent activity</h3>
        <Link
          href="/logs"
          className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-zinc-200"
        >
          Full Logs page
        </Link>
      </div>

      {loading && items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Loading activity…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No activity history yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)]/70 pb-2 text-sm last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${severityClass(item.severity)}`}>
                  {item.symbol ? `${item.symbol} · ` : ""}
                  {item.event}
                </p>
                <p className="text-xs text-[var(--muted)]">{formatTime(item.time)}</p>
              </div>
              <span className="text-xs text-[var(--muted)]">
                {severityLabel(item.severity)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
