import { decideForSymbol } from "@/lib/ai/decision";
import { getRecentBars } from "@/lib/alpaca/client";
import type { AlpacaBar, SymbolMarketSnapshot } from "@/lib/alpaca/types";
import { assessDataQuality } from "@/lib/market/data-quality";
import { scoreDecisionOutcome } from "@/lib/performance/score";
import type { BacktestResult, BacktestTradeSim } from "@/lib/performance/types";

function windowBars(bars: AlpacaBar[], endIndex: number, size: number) {
  const start = Math.max(0, endIndex - size + 1);
  return bars.slice(start, endIndex + 1);
}

function snapshotAt(
  symbol: string,
  bars: AlpacaBar[],
  endIndex: number,
): SymbolMarketSnapshot {
  const slice = windowBars(bars, endIndex, 24);
  const last = slice.at(-1)!;
  // Synthetic tight quote around close for historical simulation.
  const mid = last.c;
  const spread = Math.max(mid * 0.0004, 0.01);
  const quote = {
    symbol,
    bid: mid - spread / 2,
    ask: mid + spread / 2,
    bidSize: 1,
    askSize: 1,
    timestamp: last.t,
  };

  return {
    symbol,
    bid: quote.bid,
    ask: quote.ask,
    mid,
    last: last.c,
    spreadPct: spread / mid,
    bars: slice,
    timeframe: "5Min",
    quoteTimestamp: last.t,
    dataQuality: assessDataQuality({
      isMarketOpen: true,
      quote,
      bars: slice,
      nowMs: Date.parse(last.t) || Date.now(),
    }),
  };
}

/**
 * Simple historical backtest: replay decision logic on past bars.
 * Does NOT call order APIs. Paper simulation only.
 */
export async function runSimpleBacktest(input: {
  symbols: string[];
  lookbackBars?: number;
  step?: number;
  forwardBars?: number;
}): Promise<BacktestResult> {
  const lookbackBars = input.lookbackBars ?? 80;
  const step = input.step ?? 6;
  const forwardBars = input.forwardBars ?? 6; // ~30m on 5Min bars

  const barsBySymbol = await getRecentBars(
    input.symbols,
    "5Min",
    lookbackBars,
  );

  const decisions: BacktestTradeSim[] = [];
  let barsUsed = 0;

  for (const symbol of input.symbols) {
    const bars = barsBySymbol[symbol] ?? [];
    barsUsed += bars.length;
    if (bars.length < 30) continue;

    for (let i = 24; i < bars.length - forwardBars; i += step) {
      const snapshot = snapshotAt(symbol, bars, i);
      const decision = decideForSymbol(snapshot);
      const entry = bars[i].c;
      const later = bars[i + forwardBars]?.c ?? null;
      const scored = scoreDecisionOutcome({
        action: decision.action,
        entryPrice: entry,
        laterPrice: later,
        horizon: "m15",
        evaluatedAt: bars[i + forwardBars]?.t ?? null,
      });

      decisions.push({
        symbol,
        timestamp: bars[i].t,
        action: decision.action,
        confidence: decision.confidence,
        price: entry,
        forwardReturnPct: scored.returnPct,
        estimatedPnlPct: scored.estimatedPnlPct,
        reasonable: scored.reasonable,
        reasons: decision.reasons.slice(0, 3),
      });
    }
  }

  const pnls = decisions
    .map((d) => d.estimatedPnlPct)
    .filter((n): n is number => n != null);
  const judged = decisions.filter((d) => d.reasonable != null);
  const correct = judged.filter((d) => d.reasonable).length;

  return {
    paperOnly: true,
    orderExecutionEnabled: false,
    liveTradingAllowed: false,
    symbols: input.symbols,
    timeframe: "5Min",
    barsUsed,
    decisions,
    summary: {
      total: decisions.length,
      buy: decisions.filter((d) => d.action === "BUY").length,
      sell: decisions.filter((d) => d.action === "SELL").length,
      hold: decisions.filter((d) => d.action === "HOLD").length,
      avgEstimatedPnlPct:
        pnls.length > 0
          ? Number((pnls.reduce((a, b) => a + b, 0) / pnls.length).toFixed(5))
          : null,
      accuracy:
        judged.length > 0
          ? Number((correct / judged.length).toFixed(3))
          : null,
    },
  };
}
