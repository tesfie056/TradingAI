"use client";

import { Panel } from "@/components/ui/Panel";
import { formatTime } from "@/lib/format";
import type { OperatorBlockerSummary } from "@/lib/auto-trade/operator-blockers";

export function TradingBlockersPanel({
  summary,
  loading,
}: {
  summary: OperatorBlockerSummary | null;
  loading?: boolean;
}) {
  if (loading && !summary) {
    return (
      <Panel title="Why trading is not active">
        <p className="text-sm text-[var(--muted)]">Checking blockers…</p>
      </Panel>
    );
  }

  if (!summary) {
    return (
      <Panel title="Why trading is not active">
        <p className="text-sm text-[var(--muted)]">Blocker status unavailable.</p>
      </Panel>
    );
  }

  if (summary.tradingActive && summary.all.length === 0) {
    return (
      <Panel title="Why trading is not active">
        <p className="text-sm text-emerald-200">
          Auto Trading is active and ready for paper orders when a qualified setup appears.
        </p>
        {summary.updatedAt ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Last updated {formatTime(summary.updatedAt)}
          </p>
        ) : null}
      </Panel>
    );
  }

  const primary = summary.primary;
  return (
    <Panel title="Why trading is not active">
      {primary ? (
        <div className="rounded-[var(--radius-sm)] border border-amber-500/30 bg-amber-500/10 px-3 py-3">
          <p className="text-sm font-semibold text-amber-50">{primary.label}</p>
          <p className="mt-1 text-sm text-amber-100/90">{primary.explanation}</p>
          <p className="mt-2 text-xs text-amber-100/70">
            {primary.needsOperatorAction
              ? "Operator action needed"
              : "No immediate operator action required"}
          </p>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">No primary blocker reported.</p>
      )}

      {summary.additional.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">
            Additional blockers
          </p>
          <ul className="space-y-2 text-sm text-zinc-300">
            {summary.additional.map((b) => (
              <li
                key={b.id}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--panel-elevated)]/60 px-3 py-2"
              >
                <span className="font-medium text-zinc-100">{b.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">
                  {b.explanation}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.updatedAt ? (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Last updated {formatTime(summary.updatedAt)}
        </p>
      ) : null}
    </Panel>
  );
}
