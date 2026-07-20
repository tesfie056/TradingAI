/**
 * Risk-gated paper order submission with Version 1 lifecycle ownership.
 * Strategy proposes → risk validates → bracket order (or reject).
 * Never called by AI directly for unrestricted orders.
 */

import {
  findOrderByClientOrderId,
  getAccount,
  getOpenOrders,
  getPositions,
  placePaperOrder,
} from "@/lib/alpaca/client";
import type { AlpacaOrder } from "@/lib/alpaca/types";
import { getAutoMaxNotionalPerTrade } from "@/lib/config";
import { getRiskTradingConfig } from "@/lib/config/risk-config";
import {
  evaluateRiskProposal,
  minutesSinceOpenFromClose,
  minutesUntilClose,
} from "@/lib/risk/engine";
import { readRiskRuntime } from "@/lib/risk/runtime";
import {
  appendDecisionLog,
  proposalToLogTrade,
} from "@/lib/trading/decision-log";
import type { TradeProposal } from "@/lib/trading/proposal";
import {
  classifyPosition,
  selectV1EntryCandidate,
  submitV1BracketEntry,
  type V1LifecycleTrade,
} from "@/lib/trading/v1-lifecycle";
import { V1_STRATEGY_VERSION } from "@/lib/strategy/v1-simple-long";
import { recordLearningDecision } from "@/lib/learning/record";

export type SubmitApprovedResult =
  | {
      ok: true;
      order: AlpacaOrder;
      qty: number;
      notional: number;
      trade: V1LifecycleTrade;
    }
  | {
      ok: false;
      code: string;
      reason: string;
      trade?: V1LifecycleTrade;
    };

/**
 * Validate proposal with risk engine and submit a bracket paper order if approved.
 * Creates a Version 1 lifecycle record with stable client_order_id.
 */
export async function submitRiskApprovedEntry(input: {
  proposal: TradeProposal;
  marketOpen: boolean;
  closeAtIso?: string | null;
  marketState?: string;
  scanId?: string | null;
  decisionId?: string | null;
  strategyVersion?: string;
}): Promise<SubmitApprovedResult> {
  const proposal = input.proposal;
  const cfg = getRiskTradingConfig();
  const [account, positions, openOrders, riskRuntime] = await Promise.all([
    getAccount(),
    getPositions(),
    getOpenOrders(50),
    readRiskRuntime(),
  ]);

  // Block Version 1 BUY when legacy/external conflict (esp. AAPL short)
  const classification = positions
    .filter((p) => p.symbol.toUpperCase() === proposal.symbol.toUpperCase())
    .map((position) =>
      classifyPosition({
        position,
        v1Trades: [],
        openOrders,
      }),
    )[0];
  if (classification?.blocksV1Buy) {
    return {
      ok: false,
      code: classification.isLegacyAaplShort
        ? "legacy_aapl_short"
        : "ownership_conflict",
      reason: classification.reason,
    };
  }

  const equity = Number(account.equity);
  const openSymbols = positions
    .filter((p) => Number(p.qty) !== 0)
    .map((p) => p.symbol.toUpperCase());
  const pendingEntrySymbols = openOrders
    .filter((o) => {
      const status = (o.status ?? "").toLowerCase();
      if (!["new", "accepted", "pending_new", "partially_filled"].includes(status)) {
        return false;
      }
      return o.side === "buy" || o.side === "sell";
    })
    .map((o) => o.symbol.toUpperCase());

  const minutesToClose = minutesUntilClose(input.closeAtIso);
  const risk = evaluateRiskProposal({
    symbol: proposal.symbol,
    direction: proposal.direction,
    entryPrice: proposal.proposedEntry,
    stopLossPrice: proposal.stopLoss,
    takeProfitPrice: proposal.takeProfit,
    confidence: proposal.confidence,
    equity: Number.isFinite(equity) ? equity : 0,
    openPositionCount: openSymbols.length,
    openSymbols,
    pendingEntrySymbols,
    marketOpen: input.marketOpen,
    minutesToClose,
    minutesSinceOpen: minutesSinceOpenFromClose(
      minutesToClose,
      input.marketOpen,
    ),
    riskRuntime,
    reconciliationComplete: riskRuntime.reconciliationComplete,
    maxNotionalCap: getAutoMaxNotionalPerTrade(),
  });

  await appendDecisionLog({
    symbol: proposal.symbol,
    strategy: proposal.strategyName,
    marketState: input.marketState ?? (input.marketOpen ? "open" : "closed"),
    indicators: proposal.supportingIndicators,
    confidence: proposal.confidence,
    proposedTrade: proposalToLogTrade(proposal),
    riskValidation: {
      approved: risk.approved,
      code: risk.code,
      reason: risk.reason,
      qty: risk.qty,
      notional: risk.notional,
    },
    finalAction: risk.approved ? "submitted" : "rejected_risk",
    rejectionReason: risk.approved ? null : risk.reason,
    alpacaOrderId: null,
    error: null,
  });

  const decisionId = `risk_${proposal.symbol}_${Date.now().toString(36)}`;
  void recordLearningDecision({
    decisionId,
    eventType: risk.approved ? "proposal" : "rejection",
    symbol: proposal.symbol,
    confidence: proposal.confidence,
    isMarketOpen: input.marketOpen,
    proposal: {
      proposedEntry: proposal.proposedEntry,
      stopLoss: proposal.stopLoss,
      takeProfit: proposal.takeProfit,
      plannedRisk: null,
      plannedReward: null,
      riskRewardRatio:
        proposal.stopLoss && proposal.takeProfit && proposal.proposedEntry
          ? Math.abs(proposal.takeProfit - proposal.proposedEntry) /
            Math.max(
              1e-9,
              Math.abs(proposal.proposedEntry - proposal.stopLoss),
            )
          : null,
      direction: proposal.direction,
    },
    risk: {
      approved: risk.approved,
      code: risk.code,
      reason: risk.reason,
    },
    rejectionReason: risk.approved ? null : risk.reason,
  });

  if (!risk.approved) {
    return {
      ok: false,
      code: risk.code ?? "rejected_risk",
      reason: risk.reason ?? "Risk engine rejected proposal",
    };
  }

  if (proposal.direction !== "long") {
    return {
      ok: false,
      code: "short_not_supported",
      reason: "Version 1 only submits long entries",
    };
  }

  const candidate = await selectV1EntryCandidate({
    symbol: proposal.symbol,
    strategyVersion: input.strategyVersion ?? V1_STRATEGY_VERSION,
    scanId: input.scanId ?? null,
    decisionId: input.decisionId ?? null,
    entryDecisionId: input.decisionId ?? null,
    requestedQty: risk.qty,
    plannedEntry: proposal.proposedEntry,
    stopLoss: risk.stopLossPrice,
    takeProfit: risk.takeProfitPrice,
    expectedRisk:
      risk.qty > 0
        ? Number(
            (
              (proposal.proposedEntry - risk.stopLossPrice) *
              risk.qty
            ).toFixed(4),
          )
        : null,
    rewardToRisk:
      risk.stopLossPrice < proposal.proposedEntry
        ? Number(
            (
              (risk.takeProfitPrice - proposal.proposedEntry) /
              (proposal.proposedEntry - risk.stopLossPrice)
            ).toFixed(3),
          )
        : null,
  });

  if (!candidate.ok) {
    return {
      ok: false,
      code: candidate.code,
      reason: candidate.reason,
    };
  }

  const submitted = await submitV1BracketEntry({
    trade: candidate.trade,
    placeOrder: async ({ symbol, qty, takeProfit, stopLoss, clientOrderId }) =>
      placePaperOrder({
        symbol,
        qty,
        side: "buy",
        type: "market",
        time_in_force: "day",
        order_class: "bracket",
        take_profit: { limit_price: takeProfit },
        stop_loss: { stop_price: stopLoss },
        client_order_id: clientOrderId,
      }),
    findByClientOrderId: (id) => findOrderByClientOrderId(id),
  });

  if (!submitted.ok) {
    await appendDecisionLog({
      symbol: proposal.symbol,
      strategy: proposal.strategyName,
      marketState: input.marketState ?? (input.marketOpen ? "open" : "closed"),
      indicators: proposal.supportingIndicators,
      confidence: proposal.confidence,
      proposedTrade: proposalToLogTrade(proposal),
      riskValidation: {
        approved: true,
        code: null,
        reason: null,
        qty: risk.qty,
        notional: risk.notional,
      },
      finalAction: "rejected_broker",
      rejectionReason: submitted.reason,
      alpacaOrderId: null,
      error: submitted.reason,
    });
    void recordLearningDecision({
      decisionId: `${decisionId}_broker_reject`,
      eventType: "rejection",
      symbol: proposal.symbol,
      confidence: proposal.confidence,
      isMarketOpen: input.marketOpen,
      rejectionReason: submitted.reason,
      risk: { approved: true, code: submitted.code, reason: submitted.reason },
    });
    return {
      ok: false,
      code: submitted.code,
      reason: submitted.reason,
      trade: submitted.trade,
    };
  }

  await appendDecisionLog({
    symbol: proposal.symbol,
    strategy: proposal.strategyName,
    marketState: input.marketState ?? (input.marketOpen ? "open" : "closed"),
    indicators: {
      ...proposal.supportingIndicators,
      defaultStopLossPct: cfg.defaultStopLossPct,
      defaultTakeProfitPct: cfg.defaultTakeProfitPct,
      v1TradeId: submitted.trade.tradeId,
      clientOrderId: submitted.trade.clientOrderId,
    },
    confidence: proposal.confidence,
    proposedTrade: proposalToLogTrade(proposal),
    riskValidation: {
      approved: true,
      code: null,
      reason: null,
      qty: risk.qty,
      notional: risk.notional,
    },
    finalAction: "submitted",
    rejectionReason: null,
    alpacaOrderId: submitted.order.id,
    error: null,
  });

  void recordLearningDecision({
    decisionId: `${decisionId}_order`,
    eventType: "order",
    symbol: proposal.symbol,
    confidence: proposal.confidence,
    isMarketOpen: input.marketOpen,
    proposal: {
      proposedEntry: proposal.proposedEntry,
      stopLoss: proposal.stopLoss,
      takeProfit: proposal.takeProfit,
      plannedRisk: null,
      plannedReward: null,
      riskRewardRatio: null,
      direction: proposal.direction,
    },
    risk: { approved: true, code: null, reason: null },
    orderId: submitted.order.id,
    orderStatus: submitted.order.status,
    orderResult: "submitted",
  });

  return {
    ok: true,
    order: submitted.order,
    qty: risk.qty,
    notional: risk.notional,
    trade: submitted.trade,
  };
}
