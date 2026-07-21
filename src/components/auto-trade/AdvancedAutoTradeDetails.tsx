"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { formatTime } from "@/lib/format";
import {
  formatFractionalQty,
  formatTradeNotional,
} from "@/lib/trades/trade-display";
import type { TradeRow } from "@/lib/dashboard-types";
import type {
  AutoTradeDecision,
  AutoTradeLogEntry,
  AutoTradeStatus,
} from "@/lib/auto-trade/types";
import { formatSkipReason } from "@/lib/auto-trade/display";
import { V1LifecyclePanel } from "@/components/auto-trade/V1LifecyclePanel";
import { V1StrategyDecisionsPanel } from "@/components/auto-trade/V1StrategyDecisionsPanel";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export function AdvancedAutoTradeDetails({
  status,
  orders,
  engineNotes = [],
  legacySection,
  children,
}: {
  status: AutoTradeStatus | null;
  orders: TradeRow[];
  engineNotes?: string[];
  legacySection?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = status?.trader;

  return (
    <div id="advanced-auto-trade-details" className="scroll-mt-4">
    <Panel
      title="Advanced Details"
      action={
        <button
          type="button"
          className="ui-btn border border-[var(--border)] px-3 py-1.5 text-xs"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Collapse" : "Expand"}
        </button>
      }
    >
      <p className="text-sm text-[var(--muted)]">
        Technical diagnostics stay collapsed by default. Open only when you need
        deeper detail.
      </p>

      <div
        className={open ? "mt-4 space-y-6" : "hidden"}
        aria-hidden={!open}
      >
          {children}
          {legacySection ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">
                Legacy or external positions
              </h3>
              {legacySection}
            </section>
          ) : null}
          {engineNotes.length > 0 ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">
                Additional engine notes
              </h3>
              <ul className="space-y-1 text-sm text-zinc-300">
                {engineNotes.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">
              Reconciliation & risk snapshot
            </h3>
            <ul className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
              <li>
                Reconciliation:{" "}
                <strong className="text-zinc-100">
                  {t?.reconciliationComplete ? "Complete" : "Pending"}
                </strong>
              </li>
              <li>
                Daily loss-limit usage:{" "}
                <strong className="text-zinc-100">
                  {t?.dailyLossLimitUsagePct != null
                    ? `${t.dailyLossLimitUsagePct}%`
                    : "—"}
                </strong>
              </li>
              <li>
                Streak:{" "}
                <strong className="text-zinc-100">
                  {t?.consecutiveWins ?? 0}W / {t?.consecutiveLosses ?? 0}L
                </strong>
              </li>
              <li>
                Engine action:{" "}
                <strong className="text-zinc-100">{t?.engineAction ?? "—"}</strong>
              </li>
            </ul>
            {(t?.orphanedPositions?.length ?? 0) > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-sm text-amber-200">
                {t!.orphanedPositions.map((o) => (
                  <li key={o.symbol}>
                    {o.symbol}: {o.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">
              Paper Test Results
            </h3>
            <ul className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-3">
              <li>
                Trading session:{" "}
                <strong className="text-zinc-100">
                  {status?.paperTest?.tradingSessionStatus ?? "—"}
                </strong>
              </li>
              <li>
                Trades today:{" "}
                <strong className="text-zinc-100">
                  {status?.paperTest?.tradesToday ?? status?.dailyTradesUsed ?? 0}
                </strong>
              </li>
              <li>
                Daily P/L:{" "}
                <strong className="text-zinc-100">
                  {fmtUsd(status?.paperTest?.dailyPnL ?? t?.dailyPnL ?? 0)}
                </strong>
              </li>
              <li>
                Rejected proposals:{" "}
                <strong className="text-zinc-100">
                  {status?.paperTest?.rejectedProposals ?? 0}
                </strong>
              </li>
              <li>
                Last reconciliation:{" "}
                <strong className="text-zinc-100">
                  {status?.paperTest?.lastReconciliationAt
                    ? formatTime(status.paperTest.lastReconciliationAt)
                    : "—"}
                </strong>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">
              Top candidates
            </h3>
            {(t?.topCandidates?.length ?? 0) === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                No qualified candidates from the last scan.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-[var(--muted)]">
                    <tr>
                      <th className="py-1.5 pr-3">#</th>
                      <th className="py-1.5 pr-3">Symbol</th>
                      <th className="py-1.5 pr-3">Price</th>
                      <th className="py-1.5 pr-3">Confidence</th>
                      <th className="py-1.5">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t!.topCandidates.map((c) => (
                      <tr key={c.symbol} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-3 text-[var(--muted)]">{c.rank}</td>
                        <td className="py-2 pr-3 font-medium">{c.symbol}</td>
                        <td className="py-2 pr-3">{fmtUsd(c.currentPrice)}</td>
                        <td className="py-2 pr-3">{fmtPct(c.confidenceScore)}</td>
                        <td className="py-2 text-[var(--muted)]">
                          {c.qualificationReason ?? c.rejectionReason ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">
                Open positions (broker)
              </h3>
              {(t?.openPositions?.length ?? 0) === 0 ? (
                <p className="text-sm text-[var(--muted)]">No open positions.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {t!.openPositions.map((p) => (
                    <li
                      key={p.symbol}
                      className="flex flex-wrap justify-between gap-2 border-b border-[var(--border)]/70 pb-2"
                    >
                      <span className="font-medium">{p.symbol}</span>
                      <span className="text-[var(--muted)]">
                        {p.qty} sh · {fmtUsd(p.marketValue)} · P/L{" "}
                        {fmtUsd(p.unrealizedPl)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">
                Pending orders
              </h3>
              {(t?.pendingOrders?.length ?? 0) === 0 ? (
                <p className="text-sm text-[var(--muted)]">No pending orders.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {t!.pendingOrders.map((o) => (
                    <li
                      key={o.id}
                      className="flex flex-wrap justify-between gap-2 border-b border-[var(--border)]/70 pb-2"
                    >
                      <span className="font-medium">
                        {o.symbol} {o.side}
                      </span>
                      <span className="text-[var(--muted)]">
                        {o.qty ?? "—"} · {o.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">
              Recent paper orders
            </h3>
            {orders.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No recent paper orders.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-[var(--muted)]">
                    <tr>
                      <th className="py-1.5 pr-3">Time</th>
                      <th className="py-1.5 pr-3">Symbol</th>
                      <th className="py-1.5 pr-3">Side</th>
                      <th className="py-1.5 pr-3">Amount</th>
                      <th className="py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.slice(0, 12).map((r) => (
                      <tr key={r.id} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-3 text-[var(--muted)]">
                          {r.submittedAt ? formatTime(r.submittedAt) : "—"}
                        </td>
                        <td className="py-2 pr-3 font-medium">{r.symbol}</td>
                        <td className="py-2 pr-3 uppercase">{r.side}</td>
                        <td className="py-2 pr-3">
                          {formatTradeNotional(r.notional)}
                        </td>
                        <td className="py-2 capitalize">
                          {r.status.replace(/_/g, " ")}
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            {formatFractionalQty(r.filledQty, r.qty)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">
              Recent auto decisions
            </h3>
            <DecisionTable rows={status?.recentDecisions ?? []} />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200">
                Decision / system logs
              </h3>
              <Link href="/logs" className="text-xs underline hover:text-zinc-200">
                Logs page
              </Link>
            </div>
            <LogTable rows={status?.recentLogs ?? []} />
          </section>

          <V1StrategyDecisionsPanel />
          <V1LifecyclePanel />
      </div>
    </Panel>
    </div>
  );
}

function DecisionTable({ rows }: { rows: AutoTradeDecision[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No automatic decisions yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-[var(--muted)]">
          <tr>
            <th className="py-1.5 pr-3">Time</th>
            <th className="py-1.5 pr-3">Symbol</th>
            <th className="py-1.5 pr-3">Action</th>
            <th className="py-1.5 pr-3">Result</th>
            <th className="py-1.5">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--border)]">
              <td className="py-2 pr-3 text-[var(--muted)]">
                {formatTime(r.createdAt)}
              </td>
              <td className="py-2 pr-3 font-medium">{r.symbol}</td>
              <td className="py-2 pr-3">{r.action}</td>
              <td className="py-2 pr-3 capitalize">{r.status}</td>
              <td className="max-w-[16rem] py-2 text-[var(--muted)]">
                {r.blockers[0]
                  ? formatSkipReason(r.blockers[0].code, r.blockers[0].message)
                  : r.reason.slice(0, 80)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogTable({ rows }: { rows: AutoTradeLogEntry[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No logs yet.</p>;
  }
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-[var(--muted)]">
      {rows.map((l) => (
        <li key={l.id} className="border-b border-[var(--border)]/60 py-1">
          {formatTime(l.timestamp)} {l.symbol ?? ""} {l.message}
        </li>
      ))}
    </ul>
  );
}
