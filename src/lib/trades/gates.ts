import type { AiAction, DataQuality, RiskStatus } from "@/lib/alpaca/types";
import { WIDE_SPREAD_HOLD_PCT } from "@/lib/market/data-quality";
import type {
  OrderGateBlocker,
  OrderGateResult,
  PaperOrderSide,
} from "@/lib/trades/types";

export type EvaluateOrderGatesInput = {
  executionEnabled: boolean;
  paperEndpointOk: boolean;
  action: AiAction;
  side: PaperOrderSide;
  riskStatus: RiskStatus;
  dataQuality: DataQuality;
  qty: number;
  estimatedPrice: number | null;
  maxNotional: number;
  dailyTradeCount: number;
  maxDailyTrades: number;
  /** Required for submit; ignored for preview. */
  requireManualApproval?: boolean;
  manualApproved?: boolean;
  confirmed?: boolean;
};

function sideMatchesAction(side: PaperOrderSide, action: AiAction): boolean {
  if (action === "BUY") return side === "buy";
  if (action === "SELL") return side === "sell";
  return false;
}

/**
 * Strict execution gates for manual paper orders.
 * Pure — safe to unit-test without network.
 */
export function evaluateOrderGates(
  input: EvaluateOrderGatesInput,
): OrderGateResult {
  const blockers: OrderGateBlocker[] = [];
  const warnings: string[] = [];

  if (!input.executionEnabled) {
    blockers.push({
      code: "execution_disabled",
      message:
        "Paper order execution is disabled. Set ENABLE_PAPER_ORDER_EXECUTION=true only for intentional paper trades.",
    });
  }

  if (!input.paperEndpointOk) {
    blockers.push({
      code: "live_endpoint",
      message: "Orders are only allowed against paper-api.alpaca.markets.",
    });
  }

  if (input.action === "HOLD") {
    blockers.push({
      code: "hold_decision",
      message: "HOLD decisions cannot be submitted as orders.",
    });
  } else if (!sideMatchesAction(input.side, input.action)) {
    blockers.push({
      code: "invalid_side",
      message: `Order side "${input.side}" does not match AI action "${input.action}".`,
    });
  }

  if (input.riskStatus === "high") {
    blockers.push({
      code: "high_risk",
      message: "Orders are blocked when risk status is HIGH.",
    });
  }

  if (!input.dataQuality.isMarketOpen) {
    blockers.push({
      code: "market_closed",
      message: "Orders are blocked while the US equity market is closed.",
    });
  }

  if (input.dataQuality.isQuoteStale) {
    blockers.push({
      code: "stale_quote",
      message: "Orders are blocked when the quote is stale.",
    });
  }

  if (
    input.dataQuality.spreadPercent != null &&
    input.dataQuality.spreadPercent >= WIDE_SPREAD_HOLD_PCT
  ) {
    blockers.push({
      code: "wide_spread",
      message: `Orders are blocked when spread is too wide (≥${(WIDE_SPREAD_HOLD_PCT * 100).toFixed(0)}%).`,
    });
  } else if (
    input.dataQuality.spreadPercent == null &&
    input.action !== "HOLD"
  ) {
    blockers.push({
      code: "wide_spread",
      message: "Orders are blocked when bid/ask spread cannot be measured.",
    });
  }

  if (!(input.qty > 0) || !Number.isFinite(input.qty) || !Number.isInteger(input.qty)) {
    blockers.push({
      code: "invalid_qty",
      message: "Quantity must be a positive whole number.",
    });
  }

  if (input.estimatedPrice == null || !(input.estimatedPrice > 0)) {
    blockers.push({
      code: "missing_price",
      message: "Cannot estimate order price from current quote/bar.",
    });
  } else {
    const notional = input.estimatedPrice * input.qty;
    if (notional > input.maxNotional) {
      blockers.push({
        code: "max_notional",
        message: `Estimated notional $${notional.toFixed(2)} exceeds max $${input.maxNotional.toFixed(2)} per trade.`,
      });
    }
  }

  if (input.dailyTradeCount >= input.maxDailyTrades) {
    blockers.push({
      code: "max_daily_trades",
      message: `Daily paper trade limit reached (${input.maxDailyTrades}).`,
    });
  }

  if (input.requireManualApproval) {
    if (!input.manualApproved || !input.confirmed) {
      blockers.push({
        code: "missing_approval",
        message:
          "Manual confirmation is required. Orders are never placed automatically.",
      });
    }
  }

  if (input.riskStatus === "elevated" || input.riskStatus === "medium") {
    warnings.push("Risk is medium — review carefully before confirming.");
  }

  warnings.push("PAPER TRADE ONLY — not real money.");

  return {
    allowed: blockers.length === 0,
    blockers,
    warnings,
  };
}

/** True when AI action may show “Prepare Paper Trade”. */
export function isPreparableAction(action: AiAction | undefined): boolean {
  return action === "BUY" || action === "SELL";
}

/** Show prepare only when decision is ready for manual paper trade. */
export function canShowPreparePaperTrade(decision: {
  action: AiAction;
  readyForManualPaperTrade?: boolean;
  riskStatus?: string;
}): boolean {
  if (!isPreparableAction(decision.action)) return false;
  if (decision.readyForManualPaperTrade === false) return false;
  if (decision.riskStatus === "high") return false;
  return decision.readyForManualPaperTrade === true;
}

export function actionToSide(action: AiAction): PaperOrderSide | null {
  if (action === "BUY") return "buy";
  if (action === "SELL") return "sell";
  return null;
}
