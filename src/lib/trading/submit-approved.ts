/**
 * Risk-gated paper order submission.
 * Strategy proposes → risk validates → bracket order (or reject).
 * Never called by AI directly for unrestricted orders.
 */

import { getAccount, getOpenOrders, getPositions, placePaperOrder } from "@/lib/alpaca/client";
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

export type SubmitApprovedResult =
  | {
      ok: true;
      order: AlpacaOrder;
      qty: number;
      notional: number;
    }
  | {
      ok: false;
      code: string;
      reason: string;
    };

/**
 * Validate proposal with risk engine and submit a bracket paper order if approved.
 */
export async function submitRiskApprovedEntry(input: {
  proposal: TradeProposal;
  marketOpen: boolean;
  closeAtIso?: string | null;
  marketState?: string;
}): Promise<SubmitApprovedResult> {
  const proposal = input.proposal;
  const cfg = getRiskTradingConfig();
  const [account, positions, openOrders, riskRuntime] = await Promise.all([
    getAccount(),
    getPositions(),
    getOpenOrders(50),
    readRiskRuntime(),
  ]);

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
      // Parent entry legs — exclude stop/limit children when possible
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

  if (!risk.approved) {
    return {
      ok: false,
      code: risk.code ?? "rejected_risk",
      reason: risk.reason ?? "Risk engine rejected proposal",
    };
  }

  try {
    const order = await placePaperOrder({
      symbol: proposal.symbol,
      qty: risk.qty,
      side: proposal.direction === "long" ? "buy" : "sell",
      type: "market",
      time_in_force: "day",
      order_class: "bracket",
      take_profit: { limit_price: risk.takeProfitPrice },
      stop_loss: { stop_price: risk.stopLossPrice },
    });

    await appendDecisionLog({
      symbol: proposal.symbol,
      strategy: proposal.strategyName,
      marketState: input.marketState ?? (input.marketOpen ? "open" : "closed"),
      indicators: {
        ...proposal.supportingIndicators,
        defaultStopLossPct: cfg.defaultStopLossPct,
        defaultTakeProfitPct: cfg.defaultTakeProfitPct,
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
      alpacaOrderId: order.id,
      error: null,
    });

    return {
      ok: true,
      order,
      qty: risk.qty,
      notional: risk.notional,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Broker rejected order";
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
      rejectionReason: message,
      alpacaOrderId: null,
      error: message,
    });
    return { ok: false, code: "broker_rejected", reason: message };
  }
}
