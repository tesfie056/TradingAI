/**
 * Stage A read-only preflight for Version 1 paper smoke.
 * Never submits, cancels, or modifies Alpaca orders/positions.
 */

import { assertPaperTradingOnly } from "@/lib/alpaca/safety";
import {
  getAccount,
  getLatestQuotes,
  getMarketClock,
  getOpenOrders,
  getOrders,
  getPositions,
} from "@/lib/alpaca/client";
import { PAPER_TRADING_BASE_URL } from "@/lib/config";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import {
  getEffectiveRuntimeSettings,
  loadRuntimeSettings,
} from "@/lib/auto-trade/runtime-settings/service";
import { assessDataQuality } from "@/lib/market/data-quality";
import { marketDayKey, MARKET_TIMEZONE } from "@/lib/market/time";
import { resolveEligibleUniverse } from "@/lib/universe/service";
import { V1_DEFAULT_WATCHLIST } from "@/lib/universe/v1-default-watchlist";
import {
  V1_STRATEGY_ID,
  V1_STRATEGY_VERSION,
  evaluateV1SimpleLong,
  minutesSinceRegularOpen,
  minutesUntilRegularClose,
} from "@/lib/strategy/v1-simple-long";
import { fetchMultiTimeframeBars } from "@/lib/stocks/fetch-context";
import { readRiskRuntime } from "@/lib/risk/runtime";
import { readReconcileState } from "@/lib/trading/reconcile";
import {
  aaplShortBlocksV1Buy,
  listActiveV1Trades,
  reconcileV1Lifecycle,
} from "@/lib/trading/v1-lifecycle";
import { getV1DailyStatusSnapshot } from "@/lib/trading/v1-daily";
import { V1_SMOKE_PROFILE } from "@/lib/trading/v1-smoke/profile";
import type { V1SmokePreflightReport } from "@/lib/trading/v1-smoke/types";

function sessionLabel(clock: { isOpen: boolean; timestamp: string }): string {
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIMEZONE,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(clock.timestamp));
  const weekday = etParts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(etParts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(etParts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  if (clock.isOpen) return "regular market hours";
  if (isWeekend) return "weekend or market holiday";
  if (mins < 9 * 60 + 30) return "premarket";
  if (mins >= 16 * 60) return "after-hours";
  return "weekend or market holiday";
}

export async function runV1SmokePreflight(): Promise<V1SmokePreflightReport> {
  const baseUrl = process.env.ALPACA_BASE_URL?.trim() || PAPER_TRADING_BASE_URL;
  let paperEndpointOk = true;
  try {
    assertPaperTradingOnly(baseUrl);
  } catch {
    paperEndpointOk = false;
  }

  await loadRuntimeSettings();
  const settings = getEffectiveRuntimeSettings();
  const blockingReasons: string[] = [];
  const notes: string[] = [];

  let alpacaConnected = false;
  let equity: number | null = null;
  let buyingPower: number | null = null;
  let positions: Awaited<ReturnType<typeof getPositions>> = [];
  let openOrders: Awaited<ReturnType<typeof getOpenOrders>> = [];
  let recentOrders: Awaited<ReturnType<typeof getOrders>> = [];
  let clock: Awaited<ReturnType<typeof getMarketClock>> = {
    isOpen: false,
    timestamp: new Date().toISOString(),
    nextOpen: "",
    nextClose: "",
    paperOnly: true,
  };

  try {
    clock = await getMarketClock();
    const account = await getAccount();
    positions = await getPositions();
    openOrders = await getOpenOrders(100);
    recentOrders = await getOrders(100);
    alpacaConnected = true;
    equity = Number(account.equity);
    buyingPower = Number(account.buying_power);
    if (!Number.isFinite(equity)) equity = null;
    if (!Number.isFinite(buyingPower)) buyingPower = null;
  } catch (err) {
    blockingReasons.push(
      `Alpaca unavailable: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  const marketOpen = clock.isOpen;
  const marketSession = sessionLabel(clock);

  if (!marketOpen) {
    blockingReasons.push(
      "Market is not open — Stage A requires regular U.S. market hours. After-hours is not RTH proof.",
    );
  }
  if (marketSession !== "regular market hours") {
    notes.push(
      "Session is outside regular market hours — do not treat this preflight as RTH validation.",
    );
  }

  const universe = await resolveEligibleUniverse({
    symbols: settings.watchlist.length
      ? settings.watchlist
      : [...V1_DEFAULT_WATCHLIST],
  }).catch(() => null);

  const eligibleSymbols = (universe?.eligibleSymbols ?? []).filter(
    (s) => s.toUpperCase() !== "AAPL",
  );
  const eligibleCount = eligibleSymbols.length;
  if (eligibleCount === 0) {
    blockingReasons.push("No eligible watchlist symbols (excluding AAPL)");
  }

  const buyCandidates: V1SmokePreflightReport["strategy"]["buyCandidates"] = [];
  let buyCount = 0;
  let watchCount = 0;
  let skipCount = 0;
  let holdCount = 0;

  const riskCfg = getRiskTradingConfig();
  const nowMs = Date.now();
  let reconciliationComplete = false;
  try {
    const [riskRuntime, reconcileState] = await Promise.all([
      readRiskRuntime().catch(() => null),
      readReconcileState().catch(() => null),
    ]);
    reconciliationComplete =
      riskRuntime?.reconciliationComplete === true ||
      (reconcileState != null &&
        reconcileState.completedAt != null &&
        !reconcileState.inProgress &&
        reconcileState.error == null);
  } catch {
    reconciliationComplete = false;
  }
  if (!reconciliationComplete) {
    blockingReasons.push("Reconciliation is not healthy / incomplete");
  }

  if (eligibleSymbols.length > 0 && alpacaConnected) {
    try {
      const [quotes, multiBars] = await Promise.all([
        getLatestQuotes(eligibleSymbols),
        fetchMultiTimeframeBars(eligibleSymbols),
      ]);
      const quoteMap = new Map(
        quotes.map((q) => [q.symbol.toUpperCase(), q]),
      );
      const openSyms = new Set(
        positions
          .filter((p) => Number(p.qty) !== 0)
          .map((p) => p.symbol.toUpperCase()),
      );
      const pendingEntry = new Set(
        openOrders
          .filter((o) => o.side === "buy")
          .map((o) => o.symbol.toUpperCase()),
      );
      const pendingExit = new Set(
        openOrders
          .filter((o) => o.side === "sell")
          .map((o) => o.symbol.toUpperCase()),
      );

      for (const symbol of eligibleSymbols.slice(0, 16)) {
        const q = quoteMap.get(symbol);
        const bars5 = multiBars.bars5Min?.[symbol] ?? [];
        const dq = assessDataQuality({
          isMarketOpen: marketOpen,
          quote: q,
          bars: bars5,
          nowMs,
        });
        const result = evaluateV1SimpleLong({
          symbol,
          quote: q ?? null,
          bars5Min: bars5,
          bars15Min: multiBars.bars15Min?.[symbol] ?? [],
          bars1Min: multiBars.bars1Min?.[symbol],
          dataQuality: dq,
          context: {
            isMarketOpen: marketOpen,
            minutesSinceOpen: marketOpen
              ? minutesSinceRegularOpen(nowMs)
              : null,
            minutesToClose: marketOpen
              ? minutesUntilRegularClose(nowMs)
              : null,
            hasOpenPosition: openSyms.has(symbol),
            hasPendingEntry: pendingEntry.has(symbol),
            hasPendingExit: pendingExit.has(symbol),
            reconciliationComplete,
            universeEligible: true,
            openEntryDelayMinutes: riskCfg.openEntryDelayMinutes,
            eodEntryCutoffMinutes: riskCfg.eodEntryCutoffMinutes,
            minPrice: riskCfg.minPrice,
            maxPrice: riskCfg.maxPrice,
            maxSpreadPercent: riskCfg.maxSpreadPercent,
            stopLossPct: riskCfg.defaultStopLossPct,
            takeProfitPct: riskCfg.defaultTakeProfitPct,
            nowMs,
          },
        });
        if (result.decision === "BUY") {
          buyCount += 1;
          buyCandidates.push({
            symbol,
            score: result.score,
            entry: result.suggestedEntry,
            stop: result.suggestedStopLoss,
            take: result.suggestedTakeProfit,
            rewardToRisk: result.rewardToRisk,
            reason: result.primaryReasons[0] ?? result.explanation,
          });
        } else if (result.decision === "WATCH") watchCount += 1;
        else if (result.decision === "SKIP") skipCount += 1;
        else holdCount += 1;
      }
    } catch (err) {
      notes.push(
        `Strategy scan limited: ${err instanceof Error ? err.message : "error"}`,
      );
    }
  }

  if (marketOpen && buyCount === 0 && eligibleCount > 0) {
    notes.push(
      "No qualified BUY was available during this preflight window — safe no-trade is acceptable.",
    );
  }

  const reconcile = await reconcileV1Lifecycle({
    positions,
    openOrders,
    recentOrders,
    marketOpen,
    sessionContext: marketSession,
    dryRun: true,
  });

  const aaplPos = positions.find((p) => p.symbol.toUpperCase() === "AAPL");
  const aaplQty = aaplPos ? Number(aaplPos.qty) : null;
  const legacyShort = Boolean(aaplQty != null && aaplQty < 0);
  const blocksAapl = aaplShortBlocksV1Buy(reconcile.classifications);

  const active = await listActiveV1Trades();
  const criticalLifecycleWarnings = [
    ...reconcile.warnings
      .filter((w) => w.level === "critical")
      .map((w) => `${w.code}: ${w.message}`),
    ...active.flatMap((t) => t.criticalWarnings),
  ];
  if (criticalLifecycleWarnings.length > 0) {
    blockingReasons.push("Critical lifecycle warnings present");
  }
  if (reconcile.pauseAutoTradingRecommended) {
    blockingReasons.push("Lifecycle reconcile recommends pausing Auto Trading");
  }
  if (active.length > 0) {
    blockingReasons.push("An active Version 1-managed trade already exists");
  }

  const pendingEntries = active.filter((t) =>
    ["ENTRY_PENDING", "ENTRY_ACCEPTED", "ENTRY_PARTIALLY_FILLED"].includes(
      t.lifecycleState,
    ),
  ).length;
  const pendingExits = active.filter((t) =>
    ["EXIT_PENDING", "EXIT_ACCEPTED", "EXIT_PARTIALLY_FILLED"].includes(
      t.lifecycleState,
    ),
  ).length;
  if (pendingEntries > 0 || pendingExits > 0) {
    blockingReasons.push("Pending Version 1 entry/exit exists");
  }

  if (settings.executionEnabled) {
    notes.push(
      "Execution is currently ON before operator approval — prefer OFF until smoke submit.",
    );
  }
  if (settings.autoTradingEnabled) {
    blockingReasons.push(
      "Auto Trading is ON — Stage A supervised smoke requires Auto Trading OFF",
    );
  }
  if (!paperEndpointOk) {
    blockingReasons.push("Alpaca paper endpoint check failed");
  }
  if (!alpacaConnected) {
    blockingReasons.push("Alpaca paper account not connected");
  }

  let dailyCompleted = 0;
  let dailyTarget = 3;
  let dailyRemaining = 3;
  try {
    const daily = await getV1DailyStatusSnapshot();
    dailyCompleted = daily.session.completedTradesToday;
    dailyTarget = daily.session.dailyCompletedTradeTarget;
    dailyRemaining = Math.max(0, dailyTarget - dailyCompleted);
  } catch {
    notes.push("Daily status snapshot unavailable");
  }

  let readinessVerdict: V1SmokePreflightReport["readinessVerdict"] = "not_ready";
  if (!marketOpen) {
    readinessVerdict = "rth_required";
  } else if (
    criticalLifecycleWarnings.length > 0 ||
    !reconciliationComplete ||
    settings.autoTradingEnabled ||
    !alpacaConnected ||
    !paperEndpointOk ||
    active.length > 0 ||
    pendingEntries > 0 ||
    pendingExits > 0
  ) {
    readinessVerdict = "not_ready";
  } else if (eligibleCount === 0) {
    readinessVerdict = "not_ready";
  } else if (buyCount === 0) {
    readinessVerdict = "safe_no_trade";
  } else {
    readinessVerdict = "ready_for_operator_preview";
  }

  const host = (() => {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return "invalid";
    }
  })();

  return {
    paperOnly: true,
    liveTradingAllowed: false,
    stage: "A_preflight",
    tradingDate: marketDayKey(clock.timestamp),
    timezone: MARKET_TIMEZONE,
    generatedAt: new Date().toISOString(),
    marketSession,
    marketOpen,
    alpaca: {
      connected: alpacaConnected,
      baseUrlHost: host,
      paperEndpointOk,
      equity,
      buyingPower,
    },
    dataFreshness: universe?.dataFreshness ?? null,
    eligibleSymbols,
    eligibleCount,
    watchlistSize: universe?.watchlist?.length ?? settings.watchlist.length,
    strategy: {
      id: V1_STRATEGY_ID,
      version: V1_STRATEGY_VERSION,
      buyCount,
      watchCount,
      skipCount,
      holdCount,
      buyCandidates,
    },
    reconciliationHealthy: reconciliationComplete && !reconcile.pauseAutoTradingRecommended,
    criticalLifecycleWarnings,
    activeV1Trades: active.length,
    pendingEntries,
    pendingExits,
    openPositions: positions.map((p) => ({
      symbol: p.symbol,
      qty: Number(p.qty),
    })),
    openOrders: openOrders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      side: o.side,
      status: o.status,
    })),
    legacyAaplShort: {
      present: legacyShort,
      qty: aaplQty,
      ownership: legacyShort ? "legacy" : "none",
      untouched: true,
      blocksAaplBuy: blocksAapl,
    },
    riskSettings: {
      maxOpenPositions: settings.maxOpenPositions,
      maxTradesPerDay: settings.maxTradesPerDay,
      maxRiskPerTradePct: settings.maxRiskPerTradePct,
      maxDailyLossPct: settings.maxDailyLossPct,
    },
    dailyTarget: {
      target: dailyTarget,
      completed: dailyCompleted,
      remaining: dailyRemaining,
    },
    executionEnabled: settings.executionEnabled,
    autoTradingEnabled: settings.autoTradingEnabled,
    smokeProfile: V1_SMOKE_PROFILE,
    readinessVerdict,
    blockingReasons: [...new Set(blockingReasons)],
    mutations: {
      ordersSubmitted: 0,
      ordersCanceled: 0,
      positionsModified: 0,
    },
    notes,
  };
}
