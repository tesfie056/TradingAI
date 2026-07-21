/**
 * Submit automatic paper orders — paper endpoint only, notional by default.
 */

import {
  getAccount,
  getLatestBars,
  getLatestQuotes,
  getPositions,
  placePaperOrder,
} from "@/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "@/lib/alpaca/safety";
import type { RiskStatus } from "@/lib/alpaca/types";
import { generateWatchlistDecisions } from "@/lib/ai/decision";
import {
  getAlpacaCredentials,
  getAutoDefaultNotionalAmount,
  getDefaultOrderMode,
  getMaxDailyPaperLoss,
  getMaxDailyPaperTrades,
  isAutoPaperTradingEnabled,
  isPaperOrderExecutionEnabled,
} from "@/lib/config";
import { getFreshBrokerClock } from "@/lib/market/broker-clock";
import { assessDataQuality } from "@/lib/market/data-quality";
import type { MonitorOpportunity } from "@/lib/monitor/types";
import {
  appendAutoTradeLog,
  pruneAutoTradeLogs,
} from "@/lib/auto-trade/logs";
import {
  saveAutoTradeDecision,
  updateAutoTradeDecision,
} from "@/lib/auto-trade/decisions";
import {
  evaluateAutoTradeEligibility,
  getCooldownMs,
} from "@/lib/auto-trade/eligibility";
import {
  getAutoTradeRuntime,
  isAutoTradeRuntimeBlocked,
  recordAutoTradeActivity,
} from "@/lib/auto-trade/runtime";
import { countDailyPaperTrades, appendPaperTradeLog } from "@/lib/trades/daily-limit";
import {
  getRecentSymbolTrades,
  hasProcessedOpportunity,
} from "@/lib/auto-trade/decisions";
import {
  fetchMarketCondition,
  fetchMultiTimeframeBars,
} from "@/lib/stocks/fetch-context";
import { recordSignalDecision } from "@/lib/training/signal-loop";
import { recordLearningDecision } from "@/lib/learning/record";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import { buildLongProposal } from "@/lib/trading/proposal";
import { submitRiskApprovedEntry } from "@/lib/trading/submit-approved";
import type {
  AutoTradeDecision,
  ProcessAutoTradeResult,
} from "@/lib/auto-trade/types";

function estimatePrice(input: {
  side: "buy" | "sell";
  bid: number | null;
  ask: number | null;
  last: number | null;
}): number | null {
  if (input.side === "buy" && input.ask != null && input.ask > 0) return input.ask;
  if (input.side === "sell" && input.bid != null && input.bid > 0) return input.bid;
  if (input.last != null && input.last > 0) return input.last;
  if (input.ask != null && input.bid != null && input.ask > 0 && input.bid > 0) {
    return (input.ask + input.bid) / 2;
  }
  return null;
}

function paperEndpointOk(): boolean {
  try {
    const { baseUrl } = getAlpacaCredentials();
    assertPaperTradingOnly(baseUrl);
    return true;
  } catch {
    return false;
  }
}

async function buildEligibilityContext(
  opp: MonitorOpportunity,
  symbolTradedThisScan: boolean,
) {
  const symbol = opp.symbol.toUpperCase();
  const side = opp.action === "SELL" ? "sell" : "buy";
  const [brokerClock, quotes, latestBars, multiBars, marketCondition, runtime] =
    await Promise.all([
      getFreshBrokerClock({ force: true }),
      getLatestQuotes([symbol]),
      getLatestBars([symbol]),
      fetchMultiTimeframeBars([symbol]),
      fetchMarketCondition(),
      getAutoTradeRuntime(),
    ]);

  const quote = quotes[0];
  const bars = multiBars.bars5Min[symbol] ?? [];
  const dataQuality = assessDataQuality({
    isMarketOpen: brokerClock.isOpen,
    quote,
    bars,
  });

  const decisions = generateWatchlistDecisions({
    symbols: [symbol],
    quotes,
    barsBySymbol: multiBars.bars5Min,
    bars1MinBySymbol: multiBars.bars1Min,
    bars5MinBySymbol: multiBars.bars5Min,
    bars15MinBySymbol: multiBars.bars15Min,
    timeframe: "5Min",
    isMarketOpen: brokerClock.isOpen,
    marketCondition,
  });
  const decision = decisions[0];
  const riskStatus: RiskStatus = decision?.riskStatus ?? "unknown";
  const last = latestBars[symbol]?.close ?? null;
  const estimatedPrice = estimatePrice({
    side,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    last,
  });

  let buyingPower: number | null = null;
  let hasPosition = false;
  let positionQty = 0;
  let positionAvgEntry: number | null = null;
  try {
    const [account, positions] = await Promise.all([
      getAccount(),
      getPositions(),
    ]);
    buyingPower = Number(account.buying_power);
    if (!Number.isFinite(buyingPower)) buyingPower = null;
    const pos = positions.find((p) => p.symbol.toUpperCase() === symbol);
    if (pos && Number(pos.qty) > 0) {
      hasPosition = true;
      positionQty = Number(pos.qty);
      const avg = Number(pos.avg_entry_price);
      positionAvgEntry = Number.isFinite(avg) ? avg : null;
    }
  } catch {
    buyingPower = null;
  }

  const cooldownMs = getCooldownMs();
  const recent = await getRecentSymbolTrades(symbol, cooldownMs);
  const completed = recent
    .filter((r) => r.status === "submitted" || r.status === "filled")
    .sort(
      (a, b) =>
        new Date(b.submittedAt ?? b.createdAt).getTime() -
        new Date(a.submittedAt ?? a.createdAt).getTime(),
    );
  const lastTrade = completed[0];
  const buyCooldownActive = lastTrade?.action === "BUY";
  const sellCooldownActive = lastTrade?.action === "SELL";

  const recentBuys = recent.filter((r) => r.action === "BUY" && r.status !== "skipped");
  const recentSells = recent.filter((r) => r.action === "SELL" && r.status !== "skipped");
  const recentBuyWithoutSell = recentBuys.length > recentSells.length;

  const lastLoss = recent.find(
    (r) =>
      r.action === "BUY" &&
      r.estimatedPnL != null &&
      r.estimatedPnL < 0 &&
      (r.status === "filled" || r.status === "rejected"),
  );
  const lastTradeWasLoss = Boolean(lastLoss);

  const dailyTradeCount = await countDailyPaperTrades();
  const opportunityAlreadyProcessed = await hasProcessedOpportunity(opp.id);
  const notional = getAutoDefaultNotionalAmount();
  const runtimeBlocked = await isAutoTradeRuntimeBlocked();

  const eligibility = evaluateAutoTradeEligibility({
    opportunity: opp,
    envEnabled: isAutoPaperTradingEnabled(),
    executionEnabled: isPaperOrderExecutionEnabled(),
    runtimeBlocked,
    killSwitch: runtime.killSwitch,
    panicStop: runtime.panicStop,
    paperEndpointOk: paperEndpointOk(),
    dataQuality,
    riskStatus,
    estimatedPrice,
    notional,
    dailyTradeCount,
    dailyEstimatedPnL: runtime.dailyEstimatedPnL,
    buyingPower,
    hasPosition,
    positionQty,
    buyCooldownActive,
    sellCooldownActive,
    opportunityAlreadyProcessed,
    symbolTradedThisScan,
    recentBuyWithoutSell,
    lastTradeWasLoss,
  });

  return {
    eligibility,
    riskStatus,
    estimatedPrice,
    notional,
    side: side as "buy" | "sell",
    orderMode: getDefaultOrderMode(),
    hasPosition,
    positionQty,
    positionAvgEntry,
  };
}

export async function processAutoTradesForScan(input: {
  opportunities: MonitorOpportunity[];
  marketOpen: boolean | null;
}): Promise<ProcessAutoTradeResult> {
  const result: ProcessAutoTradeResult = {
    processed: 0,
    submitted: 0,
    skipped: 0,
    decisions: [],
  };

  if (!isAutoPaperTradingEnabled()) {
    for (const opp of input.opportunities) {
      if (opp.action === "BUY" || opp.action === "SELL") {
        await appendAutoTradeLog({
          event: "opportunity_detected",
          message: `Opportunity ${opp.symbol} ${opp.action} saved (auto trading disabled)`,
          symbol: opp.symbol,
          opportunityId: opp.id,
        });
      }
    }
    return result;
  }

  const tradeable = input.opportunities
    .filter((o) => o.action === "BUY" || o.action === "SELL")
    .sort((a, b) => {
      // Exit positions (SELL) before new entries (BUY) for day trading.
      if (a.action === "SELL" && b.action !== "SELL") return -1;
      if (b.action === "SELL" && a.action !== "SELL") return 1;
      return b.confidence - a.confidence;
    });

  const symbolsTradedThisScan = new Set<string>();

  for (const opp of tradeable) {
    result.processed += 1;
    const symbolTradedThisScan = symbolsTradedThisScan.has(opp.symbol.toUpperCase());
    await appendAutoTradeLog({
      event: "opportunity_detected",
      message: `Evaluating auto trade for ${opp.symbol} ${opp.action}`,
      symbol: opp.symbol,
      opportunityId: opp.id,
    });

    let ctx;
    try {
      ctx = await buildEligibilityContext(opp, symbolTradedThisScan);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to build eligibility context";
      await appendAutoTradeLog({
        event: "skipped",
        level: "error",
        message,
        symbol: opp.symbol,
        opportunityId: opp.id,
        skipCode: "missing_data",
      });
      result.skipped += 1;
      continue;
    }

    if (!ctx.eligibility.eligible) {
      const primary = ctx.eligibility.blockers[0];
      const allReasons = ctx.eligibility.blockers
        .map((b) => `${b.code}: ${b.message}`)
        .join(" | ");
      await appendAutoTradeLog({
        event: "eligibility_failed",
        level: "warn",
        message: allReasons || primary?.message || "Auto trade blocked",
        symbol: opp.symbol,
        opportunityId: opp.id,
        skipCode: primary?.code,
        meta: {
          blockerCount: ctx.eligibility.blockers.length,
          reasons: ctx.eligibility.blockers.map((b) => b.code).join(","),
        },
      });

      if (primary?.code === "max_daily_trades") {
        await appendAutoTradeLog({
          event: "daily_limit_reached",
          level: "warn",
          message: `Daily trade limit reached (${getMaxDailyPaperTrades()})`,
        });
      }
      if (primary?.code === "max_daily_loss") {
        await appendAutoTradeLog({
          event: "daily_loss_limit_reached",
          level: "warn",
          message: `Daily loss limit reached ($${getMaxDailyPaperLoss()})`,
        });
      }

      const skipped = await saveAutoTradeDecision({
        opportunityId: opp.id,
        symbol: opp.symbol,
        action: opp.action as "BUY" | "SELL",
        orderMode: ctx.orderMode,
        notional: ctx.notional,
        confidence: opp.confidence,
        reason: opp.reason,
        status: "skipped",
        blockers: ctx.eligibility.blockers,
        submittedAt: null,
        orderId: null,
        orderStatus: null,
        filledAvgPrice: null,
        estimatedPnL: null,
      });
      void recordSignalDecision({
        source: "auto_trade",
        symbol: opp.symbol,
        action: opp.action as "BUY" | "SELL",
        priceAtDecision: ctx.estimatedPrice,
        confidence: opp.confidence,
        placed: false,
        skipCodes: ctx.eligibility.blockers.map((b) => b.code),
        reason: allReasons || primary?.message || "skipped",
        autoTradeDecisionId: skipped.id,
      });
      void recordLearningDecision({
        decisionId: skipped.id,
        eventType: "rejection",
        symbol: opp.symbol,
        confidence: opp.confidence,
        isMarketOpen: input.marketOpen,
        rejectionReason: allReasons || primary?.message || "skipped",
        risk: {
          approved: false,
          code: primary?.code ?? "eligibility",
          reason: primary?.message ?? allReasons,
        },
      });
      result.decisions.push(skipped);
      result.skipped += 1;
      continue;
    }

    await appendAutoTradeLog({
      event: "eligibility_passed",
      message: `Auto trade eligible for ${opp.symbol} ${opp.action} ($${ctx.notional} notional)`,
      symbol: opp.symbol,
      opportunityId: opp.id,
    });

    const decision = await saveAutoTradeDecision({
      opportunityId: opp.id,
      symbol: opp.symbol,
      action: opp.action as "BUY" | "SELL",
      orderMode: "notional",
      notional: ctx.notional,
      confidence: opp.confidence,
      reason: opp.reason,
      status: "pending",
      blockers: [],
      submittedAt: null,
      orderId: null,
      orderStatus: null,
      filledAvgPrice: null,
      estimatedPnL: null,
    });

    await appendAutoTradeLog({
      event: "decision_saved",
      message: `Auto trade decision saved before submit (${decision.id})`,
      symbol: opp.symbol,
      opportunityId: opp.id,
      meta: { decisionId: decision.id },
    });

    try {
      // Version 1-managed exits are owned by the lifecycle monitor (TP/SL/max-hold/EOD).
      // Do not place a second ad-hoc SELL for a V1-owned symbol.
      if (opp.action === "SELL") {
        const { findOpenV1TradeBySymbol } = await import(
          "@/lib/trading/v1-lifecycle"
        );
        const v1Open = await findOpenV1TradeBySymbol(opp.symbol);
        if (v1Open) {
          await appendAutoTradeLog({
            event: "skipped",
            message: `SELL skipped for ${opp.symbol} — Version 1 lifecycle owns exit (${v1Open.tradeId})`,
            symbol: opp.symbol,
            opportunityId: opp.id,
            skipCode: "not_ready",
          });
          const skipped = await updateAutoTradeDecision(decision.id, {
            status: "skipped",
            blockers: [
              {
                code: "not_ready",
                message: "Version 1 lifecycle owns this position exit",
              },
            ],
          });
          if (skipped) result.decisions.push(skipped);
          result.skipped += 1;
          continue;
        }
      }

      const closePosition =
        opp.action === "SELL" && ctx.hasPosition && ctx.positionQty > 0;

      if (closePosition) {
        const order = await placePaperOrder({
          symbol: opp.symbol,
          qty: ctx.positionQty,
          side: "sell",
          type: "market",
          time_in_force: "day",
        });

        const filled =
          order.status === "filled" || order.status === "partially_filled";
        const filledQty = order.qty ? Number(order.qty) : 0;
        const fillPrice = order.filled_avg_price
          ? Number(order.filled_avg_price)
          : null;
        const estimatedPnL =
          filled && fillPrice != null && ctx.positionAvgEntry != null
            ? (fillPrice - ctx.positionAvgEntry) * filledQty
            : null;

        const updated = await updateAutoTradeDecision(decision.id, {
          status: filled ? "filled" : "submitted",
          submittedAt: order.submitted_at || new Date().toISOString(),
          orderId: order.id,
          orderStatus: order.status,
          filledAvgPrice: order.filled_avg_price,
          estimatedPnL,
        });

        await appendPaperTradeLog({
          id: order.id,
          symbol: order.symbol,
          side: order.side,
          qty: order.qty ? Number(order.qty) : ctx.positionQty,
          notional: null,
          submittedAt: order.submitted_at || new Date().toISOString(),
        });

        await recordAutoTradeActivity({
          symbol: opp.symbol,
          estimatedPnL,
        });

        await appendAutoTradeLog({
          event: filled ? "order_filled" : "order_submitted",
          message: `Auto paper SELL ${order.status} for ${opp.symbol} (${order.id})`,
          symbol: opp.symbol,
          opportunityId: opp.id,
          meta: { orderId: order.id, status: order.status },
        });

        if (updated) result.decisions.push(updated);
        void recordSignalDecision({
          source: "auto_trade",
          symbol: opp.symbol,
          action: "SELL",
          priceAtDecision: ctx.estimatedPrice,
          confidence: opp.confidence,
          placed: true,
          skipCodes: [],
          reason: `Auto paper SELL ${order.status}`,
          autoTradeDecisionId: decision.id,
        });
        result.submitted += 1;
        symbolsTradedThisScan.add(opp.symbol.toUpperCase());
        continue;
      }

      // BUY entries: proposal → risk engine → bracket order (never unrestricted).
      if (ctx.estimatedPrice == null || ctx.estimatedPrice <= 0) {
        throw new Error("Missing entry price for bracket proposal");
      }
      const riskCfg = getRiskTradingConfig();
      const proposal = buildLongProposal({
        symbol: opp.symbol,
        entry: ctx.estimatedPrice,
        stopLossPct: riskCfg.defaultStopLossPct,
        takeProfitPct: riskCfg.defaultTakeProfitPct,
        confidence: opp.confidence,
        strategyName: "v1-simple-long",
        reason: opp.reason,
        indicators: {
          technicalScore: opp.technicalScore,
          newsScore: opp.newsScore,
          marketScore: opp.marketScore,
          riskScore: opp.riskScore,
        },
      });

      // Fresh Alpaca clock immediately before paper submit (never guess open).
      const preSubmitClock = await getFreshBrokerClock({ force: true });
      if (preSubmitClock.status === "unavailable" || preSubmitClock.isOpen == null) {
        const rejected = await updateAutoTradeDecision(decision.id, {
          status: "skipped",
          blockers: [
            {
              code: "market_status_unavailable",
              message:
                preSubmitClock.error ??
                "Market status unavailable — broker clock could not be confirmed.",
            },
          ],
        });
        await appendAutoTradeLog({
          event: "skipped",
          level: "warn",
          message: `${opp.symbol}: market status unavailable — order blocked`,
          symbol: opp.symbol,
          opportunityId: opp.id,
          skipCode: "market_status_unavailable",
          meta: { decisionId: decision.id },
        });
        if (rejected) result.decisions.push(rejected);
        result.skipped += 1;
        continue;
      }
      if (preSubmitClock.isOpen !== true) {
        const rejected = await updateAutoTradeDecision(decision.id, {
          status: "skipped",
          blockers: [
            {
              code: "market_closed",
              message: "Regular market is closed — paper entry blocked.",
            },
          ],
        });
        await appendAutoTradeLog({
          event: "skipped",
          level: "info",
          message: `${opp.symbol}: market closed — order blocked`,
          symbol: opp.symbol,
          opportunityId: opp.id,
          skipCode: "market_closed",
          meta: { decisionId: decision.id },
        });
        if (rejected) result.decisions.push(rejected);
        result.skipped += 1;
        continue;
      }

      const submitted = await submitRiskApprovedEntry({
        proposal,
        marketOpen: true,
        closeAtIso: preSubmitClock.nextClose ?? null,
        marketState: "open",
        decisionId: decision.id,
        strategyVersion: "1.0.0",
      });

      if (!submitted.ok) {
        const rejected = await updateAutoTradeDecision(decision.id, {
          status: "skipped",
          blockers: [
            {
              code:
                submitted.code === "daily_loss_limit"
                  ? "max_daily_loss"
                  : submitted.code === "pending_entry" ||
                      submitted.code === "duplicate_position"
                    ? "duplicate_symbol"
                    : "not_ready",
              message: submitted.reason,
            },
          ],
        });
        await appendAutoTradeLog({
          event: "skipped",
          level: "warn",
          message: `Risk engine blocked ${opp.symbol}: ${submitted.reason}`,
          symbol: opp.symbol,
          opportunityId: opp.id,
          skipCode: "not_ready",
        });
        if (rejected) result.decisions.push(rejected);
        result.skipped += 1;
        continue;
      }

      const order = submitted.order;
      const filled =
        order.status === "filled" || order.status === "partially_filled";

      const updated = await updateAutoTradeDecision(decision.id, {
        status: filled ? "filled" : "submitted",
        submittedAt: order.submitted_at || new Date().toISOString(),
        orderId: order.id,
        orderStatus: order.status,
        filledAvgPrice: order.filled_avg_price,
        estimatedPnL: null,
      });

      await appendPaperTradeLog({
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        qty: submitted.qty,
        notional: submitted.notional,
        submittedAt: order.submitted_at || new Date().toISOString(),
      });

      await recordAutoTradeActivity({
        symbol: opp.symbol,
        estimatedPnL: null,
      });

      await appendAutoTradeLog({
        event: filled ? "order_filled" : "order_submitted",
        message: `Auto paper bracket ${order.status} for ${opp.symbol} qty=${submitted.qty} (${order.id})`,
        symbol: opp.symbol,
        opportunityId: opp.id,
        meta: {
          orderId: order.id,
          status: order.status,
          qty: submitted.qty,
          notional: submitted.notional,
        },
      });

      if (updated) result.decisions.push(updated);
      void recordSignalDecision({
        source: "auto_trade",
        symbol: opp.symbol,
        action: "BUY",
        priceAtDecision: ctx.estimatedPrice,
        confidence: opp.confidence,
        placed: true,
        skipCodes: [],
        reason: `Auto paper bracket ${order.status}`,
        autoTradeDecisionId: decision.id,
      });
      result.submitted += 1;
      symbolsTradedThisScan.add(opp.symbol.toUpperCase());
    } catch (err) {
      const message =
        err instanceof PaperTradingSafetyError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Auto paper order failed";

      const rejected = await updateAutoTradeDecision(decision.id, {
        status: "rejected",
        submittedAt: new Date().toISOString(),
        blockers: [{ code: "order_rejected", message }],
      });

      await appendAutoTradeLog({
        event: "order_rejected",
        level: "error",
        message,
        symbol: opp.symbol,
        opportunityId: opp.id,
        skipCode: "order_rejected",
      });

      if (rejected) result.decisions.push(rejected);
      result.skipped += 1;
    }
  }

  await pruneAutoTradeLogs();
  return result;
}

/** Latest auto trade decision for status API. */
export async function getLastAutoTradeDecision(): Promise<AutoTradeDecision | null> {
  const { readAutoTradeDecisions } = await import("@/lib/auto-trade/decisions");
  const rows = await readAutoTradeDecisions(1);
  return rows[0] ?? null;
}
