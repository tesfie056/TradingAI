/**
 * Build Stage A order preview from a fresh BUY-qualified strategy result.
 * Never submits orders.
 */

import { getAccount, getLatestQuotes, getMarketClock } from "@/lib/alpaca/client";
import { assessDataQuality } from "@/lib/market/data-quality";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import { sizePosition } from "@/lib/risk/sizing";
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
import { V1_SMOKE_PROFILE } from "@/lib/trading/v1-smoke/profile";
import type { V1SmokePreflightReport } from "@/lib/trading/v1-smoke/types";
import { newTradeId, buildClientOrderId } from "@/lib/trading/v1-lifecycle";

export type V1SmokeOrderPreview = {
  paperOnly: true;
  liveTradingAllowed: false;
  symbol: string;
  strategyId: string;
  strategyVersion: string;
  decisionTimestamp: string;
  bid: number | null;
  ask: number | null;
  expectedEntryPrice: number;
  quantity: number;
  notional: number;
  stopLoss: number;
  takeProfit: number;
  maximumExpectedLoss: number;
  expectedProfit: number;
  rewardToRisk: number | null;
  marketSession: string;
  dataAgeSeconds: number | null;
  activeRiskLimits: {
    maxNotionalUsd: number;
    maxRiskPerTradePct: number;
    maxDailyLossUsd: number;
  };
  stableTradeId: string;
  clientOrderId: string;
  aaplShortUnaffected: true;
  alpacaPaperTrading: true;
  reason: string;
  smokeProfileName: string;
};

export async function buildV1SmokeOrderPreview(input: {
  preflight: V1SmokePreflightReport;
  /** Optional preferred symbol; must still be a fresh BUY. */
  symbol?: string;
}): Promise<
  | { ok: true; preview: V1SmokeOrderPreview }
  | { ok: false; code: string; reason: string }
> {
  const pf = input.preflight;
  if (pf.readinessVerdict === "rth_required" || !pf.marketOpen) {
    return {
      ok: false,
      code: "rth_required",
      reason: "Stage A preview requires regular U.S. market hours",
    };
  }
  if (pf.readinessVerdict === "not_ready") {
    return {
      ok: false,
      code: "not_ready",
      reason: pf.blockingReasons.join("; ") || "Preflight not ready",
    };
  }
  if (pf.strategy.buyCount === 0 || pf.strategy.buyCandidates.length === 0) {
    return {
      ok: false,
      code: "safe_no_trade",
      reason:
        "No qualified BUY was available during the supervised smoke-test window.",
    };
  }

  let symbol = (input.symbol ?? pf.strategy.buyCandidates[0]!.symbol)
    .trim()
    .toUpperCase();
  if (symbol === "AAPL") {
    return {
      ok: false,
      code: "aapl_blocked",
      reason: "AAPL is blocked while the legacy short exists",
    };
  }

  const candidate = pf.strategy.buyCandidates.find(
    (c) => c.symbol.toUpperCase() === symbol,
  );
  if (!candidate && input.symbol) {
    return {
      ok: false,
      code: "symbol_not_buy",
      reason: `${symbol} is not among current BUY-qualified candidates`,
    };
  }
  if (!candidate) {
    symbol = pf.strategy.buyCandidates[0]!.symbol.toUpperCase();
  }

  const clock = await getMarketClock();
  if (!clock.isOpen) {
    return {
      ok: false,
      code: "rth_required",
      reason: "Market closed before preview revalidation",
    };
  }

  const [quotes, multiBars, account, riskRuntime, reconcileState] =
    await Promise.all([
      getLatestQuotes([symbol]),
      fetchMultiTimeframeBars([symbol]),
      getAccount(),
      readRiskRuntime().catch(() => null),
      readReconcileState().catch(() => null),
    ]);

  const reconciliationComplete =
    riskRuntime?.reconciliationComplete === true ||
    (reconcileState != null &&
      reconcileState.completedAt != null &&
      !reconcileState.inProgress &&
      reconcileState.error == null);

  const quote = quotes[0];
  const bars5 = multiBars.bars5Min?.[symbol] ?? [];
  const nowMs = Date.now();
  const riskCfg = getRiskTradingConfig();
  const dq = assessDataQuality({
    isMarketOpen: true,
    quote,
    bars: bars5,
    nowMs,
  });

  const result = evaluateV1SimpleLong({
    symbol,
    quote: quote ?? null,
    bars5Min: bars5,
    bars15Min: multiBars.bars15Min?.[symbol] ?? [],
    bars1Min: multiBars.bars1Min?.[symbol],
    dataQuality: dq,
    context: {
      isMarketOpen: true,
      minutesSinceOpen: minutesSinceRegularOpen(nowMs),
      minutesToClose: minutesUntilRegularClose(nowMs),
      hasOpenPosition: false,
      hasPendingEntry: false,
      hasPendingExit: false,
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

  if (result.decision !== "BUY") {
    return {
      ok: false,
      code: "safe_no_trade",
      reason: `Immediate revalidation was ${result.decision}, not BUY`,
    };
  }

  const entry = result.suggestedEntry;
  const stop = result.suggestedStopLoss;
  const take = result.suggestedTakeProfit;
  if (entry == null || stop == null || take == null) {
    return {
      ok: false,
      code: "missing_prices",
      reason: "BUY missing suggested entry, stop-loss, or take-profit",
    };
  }
  if (!(stop < entry && take > entry)) {
    return {
      ok: false,
      code: "invalid_bracket",
      reason: "Stop-loss/take-profit invalid for long entry",
    };
  }

  const equity = Number(account.equity);
  if (!Number.isFinite(equity) || equity <= 0) {
    return { ok: false, code: "no_equity", reason: "Account equity unavailable" };
  }

  const sized = sizePosition({
    equity,
    entryPrice: entry,
    stopLossPrice: stop,
    maxRiskPerTradePct: V1_SMOKE_PROFILE.maxRiskPerTradePct,
    maxNotionalCap: V1_SMOKE_PROFILE.maxNotionalUsd,
  });

  if (sized.qty <= 0 || sized.notional <= 0) {
    return {
      ok: false,
      code: "qty_zero",
      reason: "Smoke risk profile sized quantity to zero",
    };
  }
  if (sized.notional > V1_SMOKE_PROFILE.maxNotionalUsd + 0.01) {
    return {
      ok: false,
      code: "notional_cap",
      reason: `Notional ${sized.notional} exceeds smoke max ${V1_SMOKE_PROFILE.maxNotionalUsd}`,
    };
  }

  const tradeId = newTradeId();
  const clientOrderId = buildClientOrderId(tradeId, "entry");
  const maxLoss = sized.riskAmount;
  const expectedProfit = Number(
    ((take - entry) * sized.qty).toFixed(4),
  );
  const dataAgeSeconds =
    quote?.timestamp != null
      ? Math.max(
          0,
          Math.round(
            (nowMs - new Date(quote.timestamp).getTime()) / 1000,
          ),
        )
      : null;

  return {
    ok: true,
    preview: {
      paperOnly: true,
      liveTradingAllowed: false,
      symbol,
      strategyId: V1_STRATEGY_ID,
      strategyVersion: V1_STRATEGY_VERSION,
      decisionTimestamp: result.evaluatedAt,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      expectedEntryPrice: entry,
      quantity: sized.qty,
      notional: sized.notional,
      stopLoss: stop,
      takeProfit: take,
      maximumExpectedLoss: maxLoss,
      expectedProfit,
      rewardToRisk: result.rewardToRisk,
      marketSession: pf.marketSession,
      dataAgeSeconds,
      activeRiskLimits: {
        maxNotionalUsd: V1_SMOKE_PROFILE.maxNotionalUsd,
        maxRiskPerTradePct: V1_SMOKE_PROFILE.maxRiskPerTradePct,
        maxDailyLossUsd: V1_SMOKE_PROFILE.maxDailyLossUsd,
      },
      stableTradeId: tradeId,
      clientOrderId,
      aaplShortUnaffected: true,
      alpacaPaperTrading: true,
      reason: result.primaryReasons[0] ?? result.explanation,
      smokeProfileName: V1_SMOKE_PROFILE.name,
    },
  };
}

export function printV1SmokePreview(preview: V1SmokeOrderPreview): void {
  console.log("\n========== STAGE A ORDER PREVIEW (PAPER) ==========");
  console.log(`Symbol:              ${preview.symbol}`);
  console.log(
    `Strategy:            ${preview.strategyId} ${preview.strategyVersion}`,
  );
  console.log(`Decision timestamp:  ${preview.decisionTimestamp}`);
  console.log(`Bid / Ask:           ${preview.bid} / ${preview.ask}`);
  console.log(`Expected entry:      ${preview.expectedEntryPrice}`);
  console.log(`Quantity:            ${preview.quantity}`);
  console.log(`Notional:            $${preview.notional}`);
  console.log(`Stop-loss:           ${preview.stopLoss}`);
  console.log(`Take-profit:         ${preview.takeProfit}`);
  console.log(`Max expected loss:   $${preview.maximumExpectedLoss}`);
  console.log(`Expected profit:     $${preview.expectedProfit}`);
  console.log(`Reward-to-risk:      ${preview.rewardToRisk}`);
  console.log(`Market session:      ${preview.marketSession}`);
  console.log(`Data age (sec):      ${preview.dataAgeSeconds}`);
  console.log(
    `Risk limits:         notional≤$${preview.activeRiskLimits.maxNotionalUsd}, risk≤${preview.activeRiskLimits.maxRiskPerTradePct}%, dailyLoss≤$${preview.activeRiskLimits.maxDailyLossUsd}`,
  );
  console.log(`Stable trade ID:     ${preview.stableTradeId}`);
  console.log(`Client order ID:     ${preview.clientOrderId}`);
  console.log(`AAPL short:          unaffected (confirmed)`);
  console.log(`Venue:               Alpaca PAPER only`);
  console.log(`Smoke profile:       ${preview.smokeProfileName}`);
  console.log(`Reason:              ${preview.reason}`);
  console.log("====================================================\n");
  console.log(
    `To submit, re-run with: submit --symbol ${preview.symbol} --confirm "PAPER SMOKE" --enable-execution-once`,
  );
  console.log(
    "Auto Trading must remain OFF. This command will enable paper execution only for this one submission, then disable it.",
  );
}
