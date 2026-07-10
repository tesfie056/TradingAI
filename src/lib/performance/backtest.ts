import { decideForSymbol } from "@/lib/ai/decision";
import { getRecentBars } from "@/lib/alpaca/client";
import type { AlpacaBar, SymbolMarketSnapshot } from "@/lib/alpaca/types";
import { assessDataQuality } from "@/lib/market/data-quality";
import { scoreDecisionOutcome } from "@/lib/performance/score";
import type { BacktestResult, BacktestTradeSim } from "@/lib/performance/types";
import { getStrategyVersion } from "@/lib/strategy/version";

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

function filterBarsByDateRange(
  bars: AlpacaBar[],
  startDate?: string | null,
  endDate?: string | null,
): AlpacaBar[] {
  if (!startDate && !endDate) return bars;
  const startMs = startDate ? Date.parse(`${startDate}T00:00:00.000Z`) : null;
  const endMs = endDate ? Date.parse(`${endDate}T23:59:59.999Z`) : null;
  return bars.filter((b) => {
    const t = Date.parse(b.t);
    if (Number.isNaN(t)) return false;
    if (startMs != null && t < startMs) return false;
    if (endMs != null && t > endMs) return false;
    return true;
  });
}

function maxDrawdownPct(pnlsInOrder: number[]): number | null {
  if (pnlsInOrder.length === 0) return null;
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const p of pnlsInOrder) {
    equity *= 1 + p;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return Number(maxDd.toFixed(5));
}

/**
 * Simple historical backtest: replay decision logic on past bars.
 * Does NOT call order APIs. Paper simulation only. U.S. stocks only.
 */
export async function runSimpleBacktest(input: {
  symbols: string[];
  lookbackBars?: number;
  step?: number;
  forwardBars?: number;
  startDate?: string | null;
  endDate?: string | null;
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
    const rawBars = barsBySymbol[symbol] ?? [];
    const bars = filterBarsByDateRange(
      rawBars,
      input.startDate,
      input.endDate,
    );
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

  const tradeDecisions = decisions.filter((d) => d.action !== "HOLD");
  const tradePnls = tradeDecisions
    .map((d) => d.estimatedPnlPct)
    .filter((n): n is number => n != null);
  const wins = tradePnls.filter((p) => p > 0).length;
  const pnls = decisions
    .map((d) => d.estimatedPnlPct)
    .filter((n): n is number => n != null);
  const judged = decisions.filter((d) => d.reasonable != null);
  const correct = judged.filter((d) => d.reasonable).length;

  return {
    paperOnly: true,
    orderExecutionEnabled: false,
    liveTradingAllowed: false,
    strategyVersion: getStrategyVersion(),
    symbols: input.symbols,
    timeframe: "5Min",
    barsUsed,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    decisions,
    summary: {
      total: decisions.length,
      buy: decisions.filter((d) => d.action === "BUY").length,
      sell: decisions.filter((d) => d.action === "SELL").length,
      hold: decisions.filter((d) => d.action === "HOLD").length,
      tradeCount: tradeDecisions.length,
      winRate:
        tradePnls.length > 0
          ? Number((wins / tradePnls.length).toFixed(3))
          : null,
      avgEstimatedPnlPct:
        pnls.length > 0
          ? Number((pnls.reduce((a, b) => a + b, 0) / pnls.length).toFixed(5))
          : null,
      estimatedPnlPctTotal:
        tradePnls.length > 0
          ? Number(tradePnls.reduce((a, b) => a + b, 0).toFixed(5))
          : null,
      maxDrawdownPct: maxDrawdownPct(tradePnls),
      accuracy:
        judged.length > 0
          ? Number((correct / judged.length).toFixed(3))
          : null,
    },
  };
}
