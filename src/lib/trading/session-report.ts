/**
 * Paper-trading session report for soak testing.
 * Aggregates decisions, candidates, broker orders, risk, and reconcile state.
 * Stored under data/session-reports/. Paper only.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAccount, getOrders, getPositions } from "@/lib/alpaca/client";
import type { AlpacaOrder } from "@/lib/alpaca/types";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import {
  getPaperSoakProfileSummary,
  isPaperSoakProfileEnabled,
} from "@/lib/config/paper-soak-profile";
import { readAutoTradeLogs } from "@/lib/auto-trade/logs";
import { getAutoTradeRuntime } from "@/lib/auto-trade/runtime";
import { marketDayKey } from "@/lib/market/time";
import { readRiskRuntime } from "@/lib/risk/runtime";
import { getStrategyVersion } from "@/lib/strategy/version";
import { readCandidatesSnapshot } from "@/lib/trading/candidates";
import { readDecisionLog } from "@/lib/trading/decision-log";
import {
  readPaperSessionMeta,
  updateSessionEquityPeak,
} from "@/lib/trading/paper-session";
import { readReconcileState } from "@/lib/trading/reconcile";
import { countDailyPaperTrades } from "@/lib/trades/daily-limit";

const DIR = path.join(process.cwd(), "data", "session-reports");
const LATEST = path.join(process.cwd(), "data", "session-report-latest.json");

export type SessionTradeRow = {
  symbol: string;
  orderId: string | null;
  status: string;
  side: string;
  qty: number | null;
  notional: number | null;
  plannedEntry: number | null;
  filledAvgPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  plannedRisk: number | null;
  actualRisk: number | null;
  slippage: number | null;
  positionSize: number | null;
};

export type PaperSessionReport = {
  paperOnly: true;
  liveTradingAllowed: false;
  sessionDate: string;
  generatedAt: string;
  strategyVersion: string;
  soakProfile: ReturnType<typeof getPaperSoakProfileSummary>;
  engineStartedAt: string | null;
  engineStoppedAt: string | null;
  sessionStatus: "idle" | "running" | "stopped";
  symbolsScanned: string[];
  qualifiedCandidates: {
    symbol: string;
    confidence: number;
    entry: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  }[];
  rejectedCandidates: {
    symbol: string;
    reasons: string[];
  }[];
  submittedOrders: SessionTradeRow[];
  filledOrders: SessionTradeRow[];
  canceledOrRejectedOrders: SessionTradeRow[];
  realizedPnL: number;
  unrealizedPnL: number;
  winRate: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  profitFactor: number | null;
  maximumDrawdownPct: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  tradesToday: number;
  dailyLossLimitUsagePct: number | null;
  rejectedProposals: number;
  emergencyStopEvents: {
    time: string;
    message: string;
    pendingCanceled: number | null;
    positionsPreserved: number | null;
  }[];
  restartReconciliation: {
    completedAt: string | null;
    openPositionCount: number;
    openOrderCount: number;
    orphanedPositions: { symbol: string; reason: string }[];
    error: string | null;
  };
  unprotectedPositions: { symbol: string; reason: string }[];
  brokerInconsistencies: string[];
  safetyWarnings: string[];
};

export type PaperTestResultsSnapshot = {
  tradingSessionStatus: "idle" | "running" | "stopped";
  tradesToday: number;
  dailyPnL: number;
  dailyLossLimitUsagePct: number | null;
  winCount: number;
  lossCount: number;
  currentDrawdownPct: number;
  rejectedProposals: number;
  lastReconciliationAt: string | null;
  safetyWarnings: string[];
};

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function orderToRow(
  o: AlpacaOrder,
  extras?: Partial<SessionTradeRow>,
): SessionTradeRow {
  const filled = num(o.filled_avg_price);
  const planned = extras?.plannedEntry ?? null;
  const slippage =
    filled != null && planned != null && planned > 0
      ? Number((((filled - planned) / planned) * 100).toFixed(4))
      : null;
  return {
    symbol: o.symbol.toUpperCase(),
    orderId: o.id,
    status: o.status,
    side: o.side,
    qty: num(o.filled_qty) ?? num(o.qty),
    notional: num(o.notional),
    plannedEntry: planned,
    filledAvgPrice: filled,
    stopLoss: extras?.stopLoss ?? null,
    takeProfit: extras?.takeProfit ?? null,
    plannedRisk: extras?.plannedRisk ?? null,
    actualRisk: extras?.actualRisk ?? null,
    slippage,
    positionSize: num(o.filled_qty) ?? num(o.qty),
  };
}

function sameDay(iso: string, dayKey: string): boolean {
  try {
    return marketDayKey(iso) === dayKey;
  } catch {
    return false;
  }
}

/**
 * Build and persist today's paper session report.
 */
export async function buildAndPersistSessionReport(): Promise<PaperSessionReport> {
  const dayKey = marketDayKey();
  const riskCfg = getRiskTradingConfig();
  const [
    riskRuntime,
    reconcile,
    candidates,
    decisions,
    logs,
    runtime,
    tradesToday,
  ] = await Promise.all([
    readRiskRuntime(),
    readReconcileState(),
    readCandidatesSnapshot(),
    readDecisionLog(400),
    readAutoTradeLogs(200),
    getAutoTradeRuntime(),
    countDailyPaperTrades(),
  ]);

  let equity = 0;
  let unrealizedPnL = riskRuntime.dailyUnrealizedPnL;
  let brokerOrders: AlpacaOrder[] = [];
  const brokerInconsistencies: string[] = [];

  try {
    const [account, positions, orders] = await Promise.all([
      getAccount(),
      getPositions(),
      getOrders(100),
    ]);
    equity = Number(account.equity) || 0;
    if (equity > 0) await updateSessionEquityPeak(equity);
    unrealizedPnL = positions
      .filter((p) => Number(p.qty) !== 0)
      .reduce((s, p) => s + (Number(p.unrealized_pl) || 0), 0);
    brokerOrders = orders.filter((o) => sameDay(o.submitted_at || o.created_at, dayKey));
  } catch (err) {
    brokerInconsistencies.push(
      err instanceof Error
        ? `Broker fetch failed: ${err.message}`
        : "Broker fetch failed",
    );
  }

  const sessionFresh = await readPaperSessionMeta();

  const todayDecisions = decisions.filter((d) => sameDay(d.time, dayKey));
  const proposalByOrder = new Map<
    string,
    {
      entry: number;
      stop: number;
      target: number;
      plannedRisk: number | null;
    }
  >();
  for (const d of todayDecisions) {
    if (d.alpacaOrderId && d.proposedTrade) {
      const entry = d.proposedTrade.entry;
      const stop = d.proposedTrade.stopLoss;
      const qty = d.riskValidation?.qty ?? null;
      const plannedRisk =
        qty != null && entry > 0 && stop > 0
          ? Number((Math.abs(entry - stop) * qty).toFixed(4))
          : null;
      proposalByOrder.set(d.alpacaOrderId, {
        entry,
        stop,
        target: d.proposedTrade.takeProfit,
        plannedRisk,
      });
    }
  }

  const submittedOrders: SessionTradeRow[] = [];
  const filledOrders: SessionTradeRow[] = [];
  const canceledOrRejectedOrders: SessionTradeRow[] = [];

  for (const o of brokerOrders) {
    const prop = proposalByOrder.get(o.id);
    const filled = num(o.filled_avg_price);
    const stop = prop?.stop ?? null;
    const qty = num(o.filled_qty) ?? num(o.qty);
    const actualRisk =
      filled != null && stop != null && qty != null
        ? Number((Math.abs(filled - stop) * qty).toFixed(4))
        : null;
    const row = orderToRow(o, {
      plannedEntry: prop?.entry ?? null,
      stopLoss: stop,
      takeProfit: prop?.target ?? null,
      plannedRisk: prop?.plannedRisk ?? null,
      actualRisk,
    });
    const st = (o.status || "").toLowerCase();
    if (["filled", "partially_filled"].includes(st)) {
      filledOrders.push(row);
      submittedOrders.push(row);
    } else if (
      ["canceled", "cancelled", "rejected", "expired", "suspended"].includes(st)
    ) {
      canceledOrRejectedOrders.push(row);
    } else {
      submittedOrders.push(row);
    }
  }

  // Also include decision-log submissions without matching broker row yet
  for (const d of todayDecisions) {
    if (d.finalAction !== "submitted" || !d.alpacaOrderId) continue;
    if (submittedOrders.some((r) => r.orderId === d.alpacaOrderId)) continue;
    submittedOrders.push({
      symbol: d.symbol,
      orderId: d.alpacaOrderId,
      status: "submitted",
      side: d.proposedTrade?.direction === "short" ? "sell" : "buy",
      qty: d.riskValidation?.qty ?? null,
      notional: d.riskValidation?.notional ?? null,
      plannedEntry: d.proposedTrade?.entry ?? null,
      filledAvgPrice: null,
      stopLoss: d.proposedTrade?.stopLoss ?? null,
      takeProfit: d.proposedTrade?.takeProfit ?? null,
      plannedRisk: null,
      actualRisk: null,
      slippage: null,
      positionSize: d.riskValidation?.qty ?? null,
    });
  }

  const closedPnls: number[] = [];
  const realizedPnL = riskRuntime.dailyRealizedPnL;
  for (const log of logs) {
    if (log.event === "order_filled" && typeof log.meta?.estimatedPnL === "number") {
      if (sameDay(log.timestamp, dayKey)) closedPnls.push(log.meta.estimatedPnL);
    }
  }
  const winners = closedPnls.filter((p) => p > 0);
  const losers = closedPnls.filter((p) => p < 0);
  const grossWin = winners.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losers.reduce((a, b) => a + b, 0));
  const winRate =
    closedPnls.length > 0
      ? Number((winners.length / closedPnls.length).toFixed(4))
      : null;
  const averageWinner =
    winners.length > 0
      ? Number((grossWin / winners.length).toFixed(4))
      : null;
  const averageLoser =
    losers.length > 0
      ? Number((-(grossLoss / losers.length)).toFixed(4))
      : null;
  const profitFactor =
    grossLoss > 0
      ? Number((grossWin / grossLoss).toFixed(4))
      : winners.length > 0
        ? Infinity
        : null;

  const rejectedProposals = todayDecisions.filter(
    (d) =>
      d.finalAction === "rejected_risk" ||
      d.finalAction === "rejected_broker" ||
      d.finalAction === "rejected_eligibility",
  ).length;

  const emergencyStopEvents = logs
    .filter(
      (l) =>
        l.event === "panic_stop_activated" && sameDay(l.timestamp, dayKey),
    )
    .map((l) => ({
      time: l.timestamp,
      message: l.message,
      pendingCanceled:
        typeof l.meta?.pendingEntriesCanceled === "number"
          ? l.meta.pendingEntriesCanceled
          : null,
      positionsPreserved:
        typeof l.meta?.openPositionsPreserved === "number"
          ? l.meta.openPositionsPreserved
          : null,
    }));

  const qualifiedCandidates = (candidates?.candidates ?? [])
    .filter((c) => c.qualified)
    .map((c) => ({
      symbol: c.symbol,
      confidence: c.confidenceScore,
      entry: c.proposedEntry ?? null,
      stopLoss: c.stopLoss ?? null,
      takeProfit: c.takeProfit ?? null,
    }));

  const rejectedCandidates = (candidates?.candidates ?? [])
    .filter((c) => !c.qualified)
    .map((c) => ({
      symbol: c.symbol,
      reasons: c.rejectionReason
        ? [c.rejectionReason]
        : ["Did not qualify"],
    }));

  const symbolsScanned = [
    ...new Set(
      (candidates?.candidates ?? []).map((c) => c.symbol.toUpperCase()),
    ),
  ];

  const unprotectedPositions = reconcile.orphanedPositions.map((o) => ({
    symbol: o.symbol,
    reason: o.reason,
  }));

  const safetyWarnings: string[] = [];
  if (!riskRuntime.reconciliationComplete) {
    safetyWarnings.push("Reconciliation incomplete — new entries blocked");
  }
  if (runtime.panicStop) {
    safetyWarnings.push("Emergency stop active — positions preserved");
  }
  if (runtime.killSwitch) {
    safetyWarnings.push("Kill switch / pause active");
  }
  if (unprotectedPositions.length > 0) {
    safetyWarnings.push(
      `${unprotectedPositions.length} unprotected position(s) without clear SL/TP`,
    );
  }
  if (brokerInconsistencies.length > 0) {
    safetyWarnings.push(...brokerInconsistencies);
  }
  if (isPaperSoakProfileEnabled()) {
    safetyWarnings.push("Conservative paper soak profile is active");
  }

  const dailyPnL = realizedPnL + unrealizedPnL;
  const lossLimitUsd = equity > 0 ? equity * (riskCfg.maxDailyLossPct / 100) : null;
  const dailyLossLimitUsagePct =
    lossLimitUsd != null && lossLimitUsd > 0
      ? Number(
          (Math.min(100, (Math.max(0, -dailyPnL) / lossLimitUsd) * 100)).toFixed(
            1,
          ),
        )
      : null;

  const report: PaperSessionReport = {
    paperOnly: true,
    liveTradingAllowed: false,
    sessionDate: dayKey,
    generatedAt: new Date().toISOString(),
    strategyVersion: getStrategyVersion(),
    soakProfile: getPaperSoakProfileSummary(),
    engineStartedAt: sessionFresh.engineStartedAt,
    engineStoppedAt: sessionFresh.engineStoppedAt,
    sessionStatus: sessionFresh.status,
    symbolsScanned,
    qualifiedCandidates,
    rejectedCandidates,
    submittedOrders,
    filledOrders,
    canceledOrRejectedOrders,
    realizedPnL: Number(realizedPnL.toFixed(4)),
    unrealizedPnL: Number(unrealizedPnL.toFixed(4)),
    winRate,
    averageWinner,
    averageLoser,
    profitFactor:
      profitFactor === Infinity ? null : profitFactor,
    maximumDrawdownPct: sessionFresh.maxDrawdownPct,
    consecutiveLosses: riskRuntime.consecutiveLosses,
    consecutiveWins: riskRuntime.consecutiveWins,
    tradesToday,
    dailyLossLimitUsagePct,
    rejectedProposals,
    emergencyStopEvents,
    restartReconciliation: {
      completedAt: reconcile.completedAt,
      openPositionCount: reconcile.openPositionCount,
      openOrderCount: reconcile.openOrderCount,
      orphanedPositions: unprotectedPositions,
      error: reconcile.error,
    },
    unprotectedPositions,
    brokerInconsistencies,
    safetyWarnings,
  };

  await mkdir(DIR, { recursive: true });
  const dayFile = path.join(DIR, `${dayKey}.json`);
  await writeFile(dayFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(LATEST, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function readLatestSessionReport(): Promise<PaperSessionReport | null> {
  try {
    const raw = await readFile(LATEST, "utf8");
    const parsed = JSON.parse(raw) as PaperSessionReport;
    if (parsed?.paperOnly !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function toPaperTestResultsSnapshot(
  report: PaperSessionReport,
  winLoss?: { wins: number; losses: number },
): PaperTestResultsSnapshot {
  return {
    tradingSessionStatus: report.sessionStatus,
    tradesToday: report.tradesToday,
    dailyPnL: Number((report.realizedPnL + report.unrealizedPnL).toFixed(4)),
    dailyLossLimitUsagePct: report.dailyLossLimitUsagePct,
    winCount: winLoss?.wins ?? report.consecutiveWins,
    lossCount: winLoss?.losses ?? report.consecutiveLosses,
    currentDrawdownPct: report.maximumDrawdownPct,
    rejectedProposals: report.rejectedProposals,
    lastReconciliationAt: report.restartReconciliation.completedAt,
    safetyWarnings: report.safetyWarnings,
  };
}

/** Build a lightweight dashboard snapshot (refreshes report if stale). */
export async function getPaperTestResultsSnapshot(): Promise<PaperTestResultsSnapshot> {
  const latest = await readLatestSessionReport();
  const stale =
    !latest ||
    Date.now() - Date.parse(latest.generatedAt) > 60_000 ||
    latest.sessionDate !== marketDayKey();
  const report = stale ? await buildAndPersistSessionReport() : latest;
  const logs = await readAutoTradeLogs(200);
  const day = report.sessionDate;
  let wins = 0;
  let losses = 0;
  for (const log of logs) {
    if (log.event !== "order_filled") continue;
    if (!sameDay(log.timestamp, day)) continue;
    const pnl = log.meta?.estimatedPnL;
    if (typeof pnl !== "number") continue;
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
  }
  return toPaperTestResultsSnapshot(
    report,
    wins + losses > 0 ? { wins, losses } : undefined,
  );
}
