/**
 * Auto paper trading status for API / UI.
 */

import {
  getAccount,
  getOpenOrders,
  getPositions,
} from "@/lib/alpaca/client";
import {
  getAutoDefaultNotionalAmount,
  getAutoMaxNotionalPerTrade,
  getAutoTradeCooldownMinutes,
  getDefaultOrderMode,
  getMaxDailyPaperLoss,
  getMaxDailyPaperTrades,
  getMinConfidenceForAutoTrade,
  isAllowSellAuto,
} from "@/lib/config";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import { readAutoTradeDecisions } from "@/lib/auto-trade/decisions";
import { getCooldownMs } from "@/lib/auto-trade/eligibility";
import { readAutoTradeLogs } from "@/lib/auto-trade/logs";
import { getAutoTradeRuntime } from "@/lib/auto-trade/runtime";
import { buildAutoTradeBlockSummary } from "@/lib/auto-trade/block-summary";
import type { AutoTradeStatus } from "@/lib/auto-trade/types";
import { getAutoTradeAnalytics } from "@/lib/performance/auto-trade-analytics";
import {
  formatTopSignalLabel,
  readLastScanSnapshot,
} from "@/lib/monitor/scan-snapshot";
import { getMonitorServiceState } from "@/lib/monitor/service";
import { getStrategyVersion } from "@/lib/strategy/version";
import { countDailyPaperTrades } from "@/lib/trades/daily-limit";
import { readCandidatesSnapshot } from "@/lib/trading/candidates";
import { readReconcileState } from "@/lib/trading/reconcile";
import { readRiskRuntime } from "@/lib/risk/runtime";
import { getPaperTestResultsSnapshot } from "@/lib/trading/session-report";
import { getPaperSoakProfileSummary } from "@/lib/config/paper-soak-profile";
import { readUniverseSnapshot } from "@/lib/universe/service";
import {
  deriveEngineControlSnapshot,
  engineStateLabel,
} from "@/lib/auto-trade/runtime-settings/engine-state";
import { getRuntimeSettings } from "@/lib/auto-trade/runtime-settings/service";

export async function getAutoTradeStatus(): Promise<AutoTradeStatus> {
  const runtime = await getAutoTradeRuntime();
  const runtimeSettings = await getRuntimeSettings();
  const envEnabled = runtimeSettings.autoTradingEnabled;
  const executionEnabled = runtimeSettings.executionEnabled;
  const effectivelyEnabled =
    envEnabled &&
    executionEnabled &&
    !runtime.killSwitch &&
    !runtime.panicStop &&
    !runtime.runtimeDisabled;

  const [
    dailyTradesUsed,
    recentDecisions,
    recentLogs,
    analytics,
    lastScan,
    candidates,
    riskRuntime,
    reconcile,
    paperTestRaw,
    universeSnap,
  ] = await Promise.all([
    countDailyPaperTrades(),
    readAutoTradeDecisions(15),
    readAutoTradeLogs(40),
    getAutoTradeAnalytics(),
    readLastScanSnapshot(),
    readCandidatesSnapshot(),
    readRiskRuntime(),
    readReconcileState(),
    getPaperTestResultsSnapshot().catch(() => null),
    readUniverseSnapshot(),
  ]);

  let buyingPower: number | null = null;
  let equity: number | null = null;
  let openPositions: AutoTradeStatus["trader"]["openPositions"] = [];
  let pendingOrders: AutoTradeStatus["trader"]["pendingOrders"] = [];
  let marketOpen: boolean | null = null;

  try {
    const [account, positions, orders] = await Promise.all([
      getAccount(),
      getPositions(),
      getOpenOrders(30),
    ]);
    buyingPower = Number(account.buying_power);
    equity = Number(account.equity);
    if (!Number.isFinite(buyingPower)) buyingPower = null;
    if (!Number.isFinite(equity)) equity = null;
    openPositions = positions
      .filter((p) => Number(p.qty) !== 0)
      .map((p) => ({
        symbol: p.symbol.toUpperCase(),
        qty: Number(p.qty),
        marketValue: Number(p.market_value) || null,
        unrealizedPl: Number(p.unrealized_pl) || null,
      }));
    pendingOrders = orders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      status: o.status,
      qty: o.qty,
    }));
  } catch {
    // broker unavailable — UI still loads local state
  }

  const monitor = getMonitorServiceState();
  marketOpen = monitor.marketOpen;

  const riskCfg = getRiskTradingConfig();
  const dailyPnL =
    riskRuntime.dailyRealizedPnL +
    riskRuntime.dailyUnrealizedPnL +
    runtime.dailyEstimatedPnL;
  const lossLimitUsd =
    equity != null && equity > 0
      ? equity * (riskCfg.maxDailyLossPct / 100)
      : null;
  const dailyLossLimitUsagePct =
    lossLimitUsd != null && lossLimitUsd > 0
      ? Number(
          (Math.min(100, (Math.max(0, -dailyPnL) / lossLimitUsd) * 100)).toFixed(
            1,
          ),
        )
      : null;

  let engineAction = "Idle";
  if (!riskRuntime.reconciliationComplete) {
    engineAction = "Reconciling broker state…";
  } else if (runtime.panicStop) {
    engineAction = "Emergency stop — new entries blocked";
  } else if (runtime.killSwitch) {
    engineAction = "Paused (kill switch)";
  } else if (monitor.scanning) {
    engineAction = "Scanning watchlist";
  } else if (effectivelyEnabled) {
    engineAction = "Watching for qualified entries";
  } else {
    engineAction = "Auto trading off";
  }

  const engine = deriveEngineControlSnapshot({
    executionEnabled,
    autoTradingEnabled: envEnabled,
    killSwitch: runtime.killSwitch,
    panicStop: runtime.panicStop,
    runtimeDisabled: runtime.runtimeDisabled,
    marketOpen,
    dailyTradesUsed,
    maxDailyTrades: getMaxDailyPaperTrades(),
    monitorRunning: monitor.running,
    monitorScanning: monitor.scanning,
  });
  if (riskRuntime.reconciliationComplete) {
    engineAction = engineStateLabel(engine.engineState);
  }

  const lastAutoTrade =
    recentDecisions.find(
      (d) => d.status === "submitted" || d.status === "filled",
    ) ?? null;

  let nextEligibleAt: string | null = null;
  if (runtime.lastAutoTradeAt) {
    nextEligibleAt = new Date(
      new Date(runtime.lastAutoTradeAt).getTime() + getCooldownMs(),
    ).toISOString();
  }

  const cooldownMinutes = getAutoTradeCooldownMinutes();
  const since = Date.now() - cooldownMinutes * 60_000;
  const activeCooldowns: {
    symbol: string;
    side: "BUY" | "SELL";
    until: string;
  }[] = [];
  const seen = new Set<string>();
  for (const d of recentDecisions) {
    if (d.status !== "submitted" && d.status !== "filled") continue;
    const t = new Date(d.submittedAt ?? d.createdAt).getTime();
    if (t < since) continue;
    const key = `${d.symbol}:${d.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    activeCooldowns.push({
      symbol: d.symbol,
      side: d.action,
      until: new Date(t + cooldownMinutes * 60_000).toISOString(),
    });
  }

  const topCandidates = (candidates?.candidates ?? [])
    .filter((c) => c.qualified)
    .slice(0, 3);

  const base = {
    paperOnly: true as const,
    liveTradingAllowed: false as const,
    envEnabled,
    executionEnabled,
    effectivelyEnabled,
    killSwitch: runtime.killSwitch,
    panicStop: runtime.panicStop,
    runtimeDisabled: runtime.runtimeDisabled,
    defaultOrderMode: getDefaultOrderMode(),
    defaultNotional: getAutoDefaultNotionalAmount(),
    maxNotionalPerTrade: getAutoMaxNotionalPerTrade(),
    maxDailyTrades: getMaxDailyPaperTrades(),
    dailyTradesUsed,
    maxDailyLoss: getMaxDailyPaperLoss(),
    dailyEstimatedPnL: runtime.dailyEstimatedPnL,
    minConfidence: getMinConfidenceForAutoTrade(),
    cooldownMinutes,
    allowSellAuto: isAllowSellAuto(),
    lastAutoTrade,
    nextEligibleAt,
    activeCooldowns,
    recentDecisions,
    recentLogs,
    strategyVersion: getStrategyVersion(),
    analytics,
    lastScan,
    topSignalLabel: formatTopSignalLabel(lastScan),
  };

  const paperTest = paperTestRaw
    ? {
        ...paperTestRaw,
        safetyWarnings: [
          ...new Set([
            ...paperTestRaw.safetyWarnings,
            ...(universeSnap?.warnings ?? []),
          ]),
        ],
      }
    : {
        tradingSessionStatus: "idle" as const,
        tradesToday: dailyTradesUsed,
        dailyPnL: Number(dailyPnL.toFixed(4)),
        dailyLossLimitUsagePct,
        winCount: riskRuntime.consecutiveWins,
        lossCount: riskRuntime.consecutiveLosses,
        currentDrawdownPct: 0,
        rejectedProposals: 0,
        lastReconciliationAt: reconcile.completedAt,
        safetyWarnings: [
          ...(getPaperSoakProfileSummary().enabled
            ? ["Conservative paper soak profile is active"]
            : []),
          ...(!riskRuntime.reconciliationComplete
            ? ["Reconciliation incomplete — new entries blocked"]
            : []),
          ...(universeSnap?.warnings ?? []),
        ],
      };

  return {
    ...base,
    blockSummary: buildAutoTradeBlockSummary(base),
    trader: {
      mode: "paper",
      marketOpen,
      symbolsScanned:
        candidates?.symbolsScanned ?? lastScan?.stocksScanned ?? 0,
      qualifiedSymbols: candidates?.qualifiedCount ?? 0,
      topCandidates,
      openPositions,
      pendingOrders,
      buyingPower,
      equity,
      dailyPnL: Number(dailyPnL.toFixed(4)),
      dailyLossLimitUsagePct,
      consecutiveWins: riskRuntime.consecutiveWins,
      consecutiveLosses: riskRuntime.consecutiveLosses,
      engineAction,
      lastScanAt: monitor.lastScanAt ?? lastScan?.scannedAt ?? null,
      nextScanAt: monitor.nextScanAt,
      reconciliationComplete: riskRuntime.reconciliationComplete,
      orphanedPositions: reconcile.orphanedPositions,
      openPositionsPreservedNote: runtime.panicStop
        ? openPositions.length > 0
          ? `${openPositions.length} open position(s) remain — Emergency Stop does not liquidate.`
          : "Emergency stop active — no open positions."
        : null,
      universe: universeSnap
        ? {
            watchlistSize: universeSnap.watchlistSize,
            staticPassed: universeSnap.staticPassed,
            rejectedByPrice: universeSnap.rejectedByPrice,
            rejectedByLiquidity: universeSnap.rejectedByLiquidity,
            rejectedBySpread: universeSnap.rejectedBySpread,
            eligibleCount: universeSnap.eligibleCount,
            eligibleSymbols: universeSnap.eligibleSymbols,
            warnings: universeSnap.warnings,
          }
        : null,
    },
    paperTest,
    engine,
    runtimeSettings,
  };
}
