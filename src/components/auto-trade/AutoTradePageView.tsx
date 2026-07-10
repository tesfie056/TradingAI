"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useMonitorStream } from "@/components/layout/MonitorStreamContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { Panel } from "@/components/ui/Panel";
import { fetchJson } from "@/lib/client/fetch-json";
import type { TradeRow } from "@/lib/dashboard-types";
import { formatTime } from "@/lib/format";
import {
  formatFractionalQty,
  formatTradeNotional,
} from "@/lib/trades/trade-display";
import { formatSkipReason } from "@/lib/auto-trade/display";
import type {
  AutoTradeDecision,
  AutoTradeLogEntry,
  AutoTradeStatus,
} from "@/lib/auto-trade/types";
import { TradingSettingsDrawer } from "@/components/auto-trade/TradingSettingsDrawer";
import { AutoTradeControlsPanel } from "@/components/auto-trade/AutoTradeControlsPanel";
import { engineStateLabel } from "@/lib/auto-trade/runtime-settings/engine-state";

type AutoTradeApi = AutoTradeStatus & {
  ok?: boolean;
  message?: string;
  error?: string;
  emergency?: { message?: string; openPositionsPreserved?: number };
};

const INFO = {
  mode: "This app trades on Alpaca paper only. Live trading is blocked.",
  auto: "When ON, qualified paper entries can be submitted after risk checks.",
  market: "Regular U.S. equity session status from Alpaca.",
  scanned: "How many watchlist symbols were evaluated on the last scan.",
  qualified: "Symbols that passed hard filters and have a valid entry proposal.",
  dailyLoss: "Share of the daily loss limit used (realized + unrealized).",
  consecutive: "Win/loss streak used to pause new entries after repeated losses.",
  emergency:
    "Blocks new orders and cancels pending entries. Open positions stay open unless you use Close all.",
  closeAll:
    "Deliberately closes all open paper positions. Separate from Emergency Stop.",
} as const;

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function InfoTip({ text }: { text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label="More information"
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-500 text-[10px] font-semibold text-zinc-400 hover:border-zinc-300 hover:text-zinc-200"
        title={text}
      >
        i
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-left text-xs font-normal text-zinc-200 shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

function Card({
  label,
  value,
  info,
  tone = "neutral",
}: {
  label: string;
  value: string;
  info?: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const valueClass =
    tone === "ok"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-200"
        : tone === "bad"
          ? "text-red-300"
          : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
      <div className="flex items-center text-xs text-zinc-500">
        {label}
        {info ? <InfoTip text={info} /> : null}
      </div>
      <p className={`mt-1 text-base font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}

export function AutoTradePageView() {
  const stream = useMonitorStream();
  const [status, setStatus] = useState<AutoTradeApi | null>(null);
  const [orders, setOrders] = useState<TradeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [next, trades] = await Promise.all([
        fetchJson<AutoTradeApi>("/api/auto-trade"),
        fetchJson<{ trades?: TradeRow[] }>("/api/trades").catch(() => ({
          trades: [],
        })),
      ]);
      setStatus(next);
      setOrders(trades.trades ?? []);
      setError(next.error ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load auto trade");
    }
  }, []);

  const lastScanRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      void refresh().finally(() => {
        if (cancelled) return;
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [refresh]);

  useEffect(() => {
    const last = stream.status?.lastScanAt;
    if (!last || last === lastScanRef.current) return;
    lastScanRef.current = last;
    const id = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(id);
  }, [stream.status?.lastScanAt, refresh]);

  async function postAction(
    path: string,
    body?: object,
  ): Promise<{ ok: boolean; error?: string; message?: string }> {
    if (busy) return { ok: false, error: "Another action is in progress" };
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetchJson<AutoTradeApi>(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.error) {
        setError(res.error);
        return { ok: false, error: res.error, message: res.message };
      }
      setFeedback(res.message ?? "Action succeeded");
      setStatus(res);
      await refresh();
      return { ok: true, message: res.message ?? "Action succeeded" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setBusy(false);
    }
  }

  const t = status?.trader;
  const engine = status?.engine;
  const kill = engine?.killSwitchActive ?? status?.killSwitch ?? false;
  const panic = engine?.panicStopActive ?? status?.panicStop ?? false;
  const executionOn = engine?.executionEnabled ?? status?.executionEnabled ?? false;
  const autoOn = engine?.autoTradingEnabled ?? status?.envEnabled ?? false;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Auto Trading"
        description="Controlled multi-stock paper trading with risk checks and bracket exits."
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              Trading Settings
            </button>
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              {advanced ? "Simple view" : "Advanced view"}
            </button>
          </div>
        }
      />
      <SafetyBanner
        orderExecutionEnabled={executionOn}
        autoTradingEnabled={autoOn}
        engineState={engine?.engineState}
      />

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <AutoTradeControlsPanel
        engine={engine}
        busy={busy}
        feedback={feedback}
        marketOpen={t?.marketOpen ?? null}
        positions={t?.openPositions ?? []}
        riskLimits={
          status?.runtimeSettings
            ? {
                maxRiskPerTradePct: status.runtimeSettings.maxRiskPerTradePct,
                maxTradesPerDay: status.runtimeSettings.maxTradesPerDay,
                maxOpenPositions: status.runtimeSettings.maxOpenPositions,
                maxDailyLossPct: status.runtimeSettings.maxDailyLossPct,
                maxPositionAllocationPct:
                  status.runtimeSettings.maxPositionAllocationPct,
              }
            : null
        }
        onAction={postAction}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          label="Mode"
          value="Paper"
          info={INFO.mode}
          tone="ok"
        />
        <Card
          label="Execution"
          value={executionOn ? "ON" : "OFF"}
          tone={executionOn ? "warn" : "neutral"}
        />
        <Card
          label="Auto trading"
          value={autoOn ? "ON" : "OFF"}
          info={INFO.auto}
          tone={autoOn ? "ok" : "warn"}
        />
        <Card
          label="Engine"
          value={
            engine?.engineState
              ? engineStateLabel(engine.engineState)
              : (t?.engineAction ?? "—")
          }
          tone={panic ? "bad" : kill ? "warn" : "neutral"}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          label="Symbols scanned"
          value={String(t?.symbolsScanned ?? 0)}
          info={INFO.scanned}
        />
        <Card
          label="Qualified"
          value={String(t?.qualifiedSymbols ?? 0)}
          info={INFO.qualified}
        />
        <Card
          label="Trades today"
          value={`${status?.dailyTradesUsed ?? 0} / ${status?.maxDailyTrades ?? 3}`}
        />
        <Card
          label="Daily P/L"
          value={fmtUsd(t?.dailyPnL ?? status?.dailyEstimatedPnL ?? 0)}
          tone={
            (t?.dailyPnL ?? 0) < 0
              ? "bad"
              : (t?.dailyPnL ?? 0) > 0
                ? "ok"
                : "neutral"
          }
        />
      </div>

      <Panel title="Status">
        <p className="text-sm text-zinc-200">
          {status?.blockSummary?.primaryReason ??
            (engine?.effectivelyAutoTrading
              ? "Auto trading is active."
              : engine?.canScan
                ? "Scanning only — auto trading is off."
                : "Engine is paused or blocked.")}
        </p>
        <ul className="mt-3 grid gap-1 text-sm text-zinc-400 sm:grid-cols-2">
          <li>
            Agent:{" "}
            <strong className="text-zinc-200">
              {stream.scanning
                ? "Scanning"
                : engine?.canScan
                  ? "Idle (ready to scan)"
                  : "Stopped"}
            </strong>
          </li>
          <li>
            Last scan:{" "}
            <strong className="text-zinc-200">
              {t?.lastScanAt ? formatTime(t.lastScanAt) : "—"}
            </strong>
          </li>
          <li>
            Next scan:{" "}
            <strong className="text-zinc-200">
              {t?.nextScanAt ? formatTime(t.nextScanAt) : "—"}
            </strong>
          </li>
          <li>
            Buying power:{" "}
            <strong className="text-zinc-200">{fmtUsd(t?.buyingPower)}</strong>
          </li>
          <li className="flex items-center">
            Daily loss limit used:{" "}
            <strong className="ml-1 text-zinc-200">
              {t?.dailyLossLimitUsagePct != null
                ? `${t.dailyLossLimitUsagePct}%`
                : "—"}
            </strong>
            <InfoTip text={INFO.dailyLoss} />
          </li>
          <li className="flex items-center">
            Streak:{" "}
            <strong className="ml-1 text-zinc-200">
              {t?.consecutiveWins ?? 0}W / {t?.consecutiveLosses ?? 0}L
            </strong>
            <InfoTip text={INFO.consecutive} />
          </li>
        </ul>
        {t?.openPositionsPreservedNote ? (
          <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            {t.openPositionsPreservedNote}
          </p>
        ) : null}
      </Panel>

      <Panel title="Universe">
        <ul className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-3">
          <li>
            Watchlist size:{" "}
            <strong className="text-zinc-100">
              {t?.universe?.watchlistSize ?? "—"}
            </strong>
          </li>
          <li>
            Passing static filters:{" "}
            <strong className="text-zinc-100">
              {t?.universe?.staticPassed ?? "—"}
            </strong>
          </li>
          <li>
            Rejected by price:{" "}
            <strong className="text-zinc-100">
              {t?.universe?.rejectedByPrice ?? "—"}
            </strong>
          </li>
          <li>
            Rejected by liquidity:{" "}
            <strong className="text-zinc-100">
              {t?.universe?.rejectedByLiquidity ?? "—"}
            </strong>
          </li>
          <li>
            Rejected by spread:{" "}
            <strong className="text-zinc-100">
              {t?.universe?.rejectedBySpread ?? "—"}
            </strong>
          </li>
          <li>
            Final eligible universe:{" "}
            <strong className="text-zinc-100">
              {t?.universe?.eligibleCount ?? "—"}
            </strong>
          </li>
        </ul>
        {t?.universe?.eligibleSymbols?.length ? (
          <p className="mt-2 text-xs text-zinc-500">
            Eligible: {t.universe.eligibleSymbols.slice(0, 20).join(", ")}
            {t.universe.eligibleSymbols.length > 20 ? "…" : ""}
          </p>
        ) : null}
        {(t?.universe?.warnings?.length ?? 0) > 0 ? (
          <ul className="mt-3 space-y-1 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            {t!.universe!.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Paper Test Results">
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
            <strong
              className={
                (status?.paperTest?.dailyPnL ?? 0) < 0
                  ? "text-red-300"
                  : (status?.paperTest?.dailyPnL ?? 0) > 0
                    ? "text-emerald-300"
                    : "text-zinc-100"
              }
            >
              {fmtUsd(status?.paperTest?.dailyPnL ?? t?.dailyPnL ?? 0)}
            </strong>
          </li>
          <li>
            Daily loss-limit usage:{" "}
            <strong className="text-zinc-100">
              {status?.paperTest?.dailyLossLimitUsagePct != null
                ? `${status.paperTest.dailyLossLimitUsagePct}%`
                : t?.dailyLossLimitUsagePct != null
                  ? `${t.dailyLossLimitUsagePct}%`
                  : "—"}
            </strong>
          </li>
          <li>
            Win / loss:{" "}
            <strong className="text-zinc-100">
              {status?.paperTest?.winCount ?? 0} /{" "}
              {status?.paperTest?.lossCount ?? 0}
            </strong>
          </li>
          <li>
            Current drawdown:{" "}
            <strong className="text-zinc-100">
              {status?.paperTest?.currentDrawdownPct != null
                ? `${status.paperTest.currentDrawdownPct}%`
                : "—"}
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
        {(status?.paperTest?.safetyWarnings?.length ?? 0) > 0 ? (
          <ul className="mt-3 space-y-1 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            {status!.paperTest!.safetyWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">No safety warnings.</p>
        )}
      </Panel>

      <TradingSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initial={status?.runtimeSettings ?? null}
        onSaved={() => {
          void refresh();
        }}
      />

      <Panel title="Top candidates">
        {(t?.topCandidates?.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-500">
            Run the monitor to scan your watchlist for qualified entries.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1.5 pr-3">#</th>
                  <th className="py-1.5 pr-3">Symbol</th>
                  <th className="py-1.5 pr-3">Price</th>
                  <th className="py-1.5 pr-3">Confidence</th>
                  <th className="py-1.5 pr-3">R:R</th>
                  <th className="py-1.5">Why</th>
                </tr>
              </thead>
              <tbody>
                {t!.topCandidates.map((c) => (
                  <tr key={c.symbol} className="border-t border-zinc-800">
                    <td className="py-2 pr-3 text-zinc-500">{c.rank}</td>
                    <td className="py-2 pr-3 font-medium">{c.symbol}</td>
                    <td className="py-2 pr-3">{fmtUsd(c.currentPrice)}</td>
                    <td className="py-2 pr-3">{fmtPct(c.confidenceScore)}</td>
                    <td className="py-2 pr-3">
                      {c.riskRewardRatio?.toFixed(2) ?? "—"}
                    </td>
                    <td className="py-2 text-zinc-400">
                      {c.qualificationReason ?? c.rejectionReason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Open positions">
          {(t?.openPositions?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No open positions.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {t!.openPositions.map((p) => (
                <li
                  key={p.symbol}
                  className="flex flex-wrap justify-between gap-2 border-b border-zinc-800/80 pb-2"
                >
                  <span className="font-medium">{p.symbol}</span>
                  <span className="text-zinc-400">
                    {p.qty} sh · {fmtUsd(p.marketValue)} · P/L{" "}
                    <span
                      className={
                        (p.unrealizedPl ?? 0) < 0
                          ? "text-red-300"
                          : "text-emerald-300"
                      }
                    >
                      {fmtUsd(p.unrealizedPl)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Pending orders">
          {(t?.pendingOrders?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No pending orders.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {t!.pendingOrders.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-wrap justify-between gap-2 border-b border-zinc-800/80 pb-2"
                >
                  <span className="font-medium">
                    {o.symbol} {o.side}
                  </span>
                  <span className="text-zinc-400">
                    {o.qty ?? "—"} · {o.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Recent auto decisions">
        <DecisionTable rows={status?.recentDecisions ?? []} />
      </Panel>

      <Panel title="Recent paper orders">
        <OrdersTable rows={orders.slice(0, 12)} />
      </Panel>

      {advanced ? (
        <Panel title="Advanced details">
          <div className="flex flex-col gap-4 text-sm text-zinc-400">
            <p>
              Reconciliation:{" "}
              <strong className="text-zinc-200">
                {t?.reconciliationComplete ? "Complete" : "Pending"}
              </strong>
            </p>
            {(t?.orphanedPositions?.length ?? 0) > 0 ? (
              <div>
                <p className="mb-1 text-amber-200">Unprotected positions</p>
                <ul className="list-disc pl-5">
                  {t!.orphanedPositions.map((o) => (
                    <li key={o.symbol}>
                      {o.symbol}: {o.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-zinc-300">Decision / system logs</h3>
              <Link href="/logs" className="text-xs underline hover:text-zinc-200">
                Logs page
              </Link>
            </div>
            <LogTable rows={status?.recentLogs ?? []} />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function DecisionTable({ rows }: { rows: AutoTradeDecision[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No automatic decisions yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1.5 pr-3">Time</th>
            <th className="py-1.5 pr-3">Symbol</th>
            <th className="py-1.5 pr-3">Action</th>
            <th className="py-1.5 pr-3">Amount</th>
            <th className="py-1.5 pr-3">Result</th>
            <th className="py-1.5">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-zinc-800">
              <td className="py-2 pr-3 text-zinc-500">{formatTime(r.createdAt)}</td>
              <td className="py-2 pr-3 font-medium">{r.symbol}</td>
              <td className="py-2 pr-3">{r.action}</td>
              <td className="py-2 pr-3">${r.notional.toFixed(2)}</td>
              <td className="py-2 pr-3 capitalize">{r.status}</td>
              <td className="max-w-[16rem] py-2 text-zinc-400">
                {r.blockers[0]
                  ? formatSkipReason(r.blockers[0].code, r.blockers[0].message)
                  : r.status === "submitted" || r.status === "filled"
                    ? "Paper order placed"
                    : r.reason.slice(0, 80)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrdersTable({ rows }: { rows: TradeRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No recent paper orders.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1.5 pr-3">Time</th>
            <th className="py-1.5 pr-3">Symbol</th>
            <th className="py-1.5 pr-3">Side</th>
            <th className="py-1.5 pr-3">Amount</th>
            <th className="py-1.5 pr-3">Filled shares</th>
            <th className="py-1.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-zinc-800">
              <td className="py-2 pr-3 text-zinc-500">
                {r.submittedAt ? formatTime(r.submittedAt) : "—"}
              </td>
              <td className="py-2 pr-3 font-medium">{r.symbol}</td>
              <td className="py-2 pr-3 uppercase">{r.side}</td>
              <td className="py-2 pr-3">{formatTradeNotional(r.notional)}</td>
              <td className="py-2 pr-3 text-zinc-400">
                {formatFractionalQty(r.filledQty, r.qty)}
              </td>
              <td className="py-2 capitalize">{r.status.replace(/_/g, " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogTable({ rows }: { rows: AutoTradeLogEntry[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No logs yet.</p>;
  }
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-zinc-500">
      {rows.map((l) => (
        <li key={l.id} className="border-b border-zinc-800/60 py-1">
          {formatTime(l.timestamp)} {l.symbol ?? ""} {l.message}
        </li>
      ))}
    </ul>
  );
}
