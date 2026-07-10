"use client";

import { ActionBadge } from "@/components/ui/badges";
import { ScrollTable } from "@/components/ui/ScrollTable";
import { formatTime } from "@/lib/format";
import type { TradeRow } from "@/lib/dashboard-types";
import {
  formatFillPrice,
  formatFractionalQty,
  formatOrderModeLabel,
  formatTradeNotional,
} from "@/lib/trades/trade-display";

export function PaperOrdersTable({
  trades,
  limit = 10,
  timeColumn = "filled",
}: {
  trades: TradeRow[];
  limit?: number;
  /** Use filled time when available, else submitted. */
  timeColumn?: "filled" | "submitted";
}) {
  const rows = trades.slice(0, limit);

  return (
    <ScrollTable minWidthClass="min-w-[48rem] sm:min-w-[56rem]">
      <table className="w-full text-left text-sm sm:text-base">
        <thead>
          <tr className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted)] sm:text-sm">
            <th className="py-3 pr-3 font-medium">Time</th>
            <th className="py-3 pr-3 font-medium">Symbol</th>
            <th className="py-3 pr-3 font-medium">Side</th>
            <th className="py-3 pr-3 font-medium">Mode</th>
            <th className="py-3 pr-3 font-medium">Notional</th>
            <th className="py-3 pr-3 font-medium">Filled qty</th>
            <th className="py-3 pr-3 font-medium">Avg fill</th>
            <th className="py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-b border-[var(--border)]/50">
              <td className="py-3 pr-3 text-[var(--muted)]">
                {formatTime(
                  timeColumn === "submitted"
                    ? t.submittedAt
                    : (t.filledAt ?? t.submittedAt),
                )}
              </td>
              <td className="py-3 pr-3 text-lg font-semibold">{t.symbol}</td>
              <td className="py-3 pr-3">
                <ActionBadge action={t.side} />
              </td>
              <td className="py-3 pr-3">{formatOrderModeLabel(t.orderMode)}</td>
              <td className="py-3 pr-3 tabular-nums">
                {t.orderMode === "notional"
                  ? formatTradeNotional(t.notional)
                  : "—"}
              </td>
              <td className="py-3 pr-3 tabular-nums">
                {formatFractionalQty(t.filledQty, t.qty)}
              </td>
              <td className="py-3 pr-3 tabular-nums">
                {formatFillPrice(t.filledAvgPrice)}
              </td>
              <td className="py-3 text-[var(--muted)]">{t.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
