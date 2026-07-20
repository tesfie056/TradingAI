/**
 * Alpaca bracket order helpers — paper only.
 */

export type BracketOrderInput = {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  takeProfitLimitPrice: number;
  stopLossStopPrice: number;
  time_in_force?: "day" | "gtc";
  /** Stable Alpaca client_order_id for Version 1 ownership / idempotency. */
  client_order_id?: string;
};

export type BracketOrderBody = {
  symbol: string;
  qty: string;
  side: "buy" | "sell";
  type: "market";
  time_in_force: "day" | "gtc";
  order_class: "bracket";
  take_profit: { limit_price: string };
  stop_loss: { stop_price: string };
  client_order_id?: string;
};

/**
 * Build a bracket order body (entry + take-profit + stop-loss).
 * Uses qty only — Alpaca brackets do not support notional.
 */
export function buildBracketOrderBody(input: BracketOrderInput): BracketOrderBody {
  if (!(input.qty > 0)) {
    throw new Error("Bracket order requires positive qty");
  }
  if (!(input.takeProfitLimitPrice > 0) || !(input.stopLossStopPrice > 0)) {
    throw new Error("Bracket order requires take-profit and stop-loss prices");
  }
  if (input.side === "buy") {
    if (input.stopLossStopPrice >= input.takeProfitLimitPrice) {
      throw new Error("Long bracket: stop must be below take-profit");
    }
  }

  const body: BracketOrderBody = {
    symbol: input.symbol.toUpperCase(),
    qty: String(input.qty),
    side: input.side,
    type: "market",
    time_in_force: input.time_in_force ?? "day",
    order_class: "bracket",
    take_profit: {
      limit_price: String(input.takeProfitLimitPrice),
    },
    stop_loss: {
      stop_price: String(input.stopLossStopPrice),
    },
  };
  if (input.client_order_id) {
    body.client_order_id = input.client_order_id.slice(0, 48);
  }
  return body;
}
