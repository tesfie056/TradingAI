/**
 * Trade proposal — strategy output before risk validation.
 * AI/strategy never submits orders directly.
 */

export type TradeProposal = {
  symbol: string;
  direction: "long" | "short";
  proposedEntry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  strategyName: string;
  reason: string;
  supportingIndicators: Record<string, string | number | boolean | null>;
  paperOnly: true;
};

export function buildLongProposal(input: {
  symbol: string;
  entry: number;
  stopLossPct: number;
  takeProfitPct: number;
  confidence: number;
  strategyName: string;
  reason: string;
  indicators?: Record<string, string | number | boolean | null>;
}): TradeProposal {
  const entry = input.entry;
  const stop = Number((entry * (1 - input.stopLossPct / 100)).toFixed(4));
  const target = Number((entry * (1 + input.takeProfitPct / 100)).toFixed(4));
  return {
    symbol: input.symbol.toUpperCase(),
    direction: "long",
    proposedEntry: entry,
    stopLoss: stop,
    takeProfit: target,
    confidence: input.confidence,
    strategyName: input.strategyName,
    reason: input.reason,
    supportingIndicators: input.indicators ?? {},
    paperOnly: true,
  };
}
