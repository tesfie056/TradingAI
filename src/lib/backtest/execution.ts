/**
 * Deterministic bar-based execution simulator.
 * Conservative: on same-candle SL+TP touch, stop fills first.
 */

import {
  applyEntryCosts,
  defaultAssumptions,
  estimateSlippagePct,
  estimateSpreadPct,
} from "@/lib/backtest/costs";
import { evaluateStrategyAt } from "@/lib/backtest/evaluator";
import { historicalToAlpaca } from "@/lib/backtest/historical-data";
import type {
  ExecutionAssumptions,
  HistoricalBar,
  SimTrade,
} from "@/lib/backtest/types";
import type { MarketRegime } from "@/lib/learning/regime";
import type { RiskRuntimeState } from "@/lib/risk/runtime";

function newTradeId(): string {
  return `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

type OpenPos = {
  symbol: string;
  entryIdx: number;
  entryTime: string;
  fillEntry: number;
  stop: number;
  target: number;
  qty: number;
  spreadCost: number;
  slippageCost: number;
  confidence: number;
  regime: MarketRegime | "unknown";
  strategyVersion: string;
};

export type SimAccountSnapshot = {
  equity: number;
  cash: number;
  open: OpenPos[];
  tradesToday: number;
  dayKey: string;
  realizedToday: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  riskRuntime: RiskRuntimeState;
};

/** Pure exit resolution for one bar (used by tests + simulator). */
export function resolveSameCandleExit(input: {
  stop: number;
  target: number;
  low: number;
  high: number;
  close: number;
  isLastBar: boolean;
  stopFirst?: boolean;
}): {
  exitPrice: number | null;
  exitReason: SimTrade["exitReason"] | null;
  sameCandleCollision: boolean;
} {
  const hitStop = input.low <= input.stop;
  const hitTarget = input.high >= input.target;
  const stopFirst = input.stopFirst !== false;
  if (hitStop && hitTarget) {
    return {
      exitPrice: stopFirst ? input.stop : input.target,
      exitReason: stopFirst ? "stop" : "target",
      sameCandleCollision: true,
    };
  }
  if (hitStop) {
    return { exitPrice: input.stop, exitReason: "stop", sameCandleCollision: false };
  }
  if (hitTarget) {
    return {
      exitPrice: input.target,
      exitReason: "target",
      sameCandleCollision: false,
    };
  }
  if (input.isLastBar) {
    return { exitPrice: input.close, exitReason: "eod", sameCandleCollision: false };
  }
  return { exitPrice: null, exitReason: null, sameCandleCollision: false };
}

export function simulateSymbolPath(input: {
  symbol: string;
  bars: HistoricalBar[];
  assumptions?: Partial<ExecutionAssumptions>;
  strategyVersion?: string;
  minConfidence?: number;
  blockedRegimes?: string[];
  step?: number;
  maxTradesPerDay?: number;
  maxOpenPositions?: number;
  maxDailyLossPct?: number;
}): { trades: SimTrade[]; assumptions: ExecutionAssumptions } {
  const assumptions = defaultAssumptions(input.assumptions);
  const bars = input.bars;
  const step = input.step ?? 6;
  const alpaca = historicalToAlpaca(bars);
  const trades: SimTrade[] = [];

  let equity = assumptions.startingEquity;
  let open: OpenPos | null = null;
  let tradesToday = 0;
  let dayKey = "";
  let realizedToday = 0;
  let consecutiveLosses = 0;
  let consecutiveWins = 0;

  const maxTrades = input.maxTradesPerDay ?? 3;
  const maxOpen = input.maxOpenPositions ?? 3;
  const maxDailyLossPct = input.maxDailyLossPct ?? 2;

  for (let i = 30; i < bars.length; i++) {
    const bar = bars[i]!;
    const dkey = bar.timestamp.slice(0, 10);
    if (dkey !== dayKey) {
      dayKey = dkey;
      tradesToday = 0;
      realizedToday = 0;
      // Backtest: consecutive-loss pause clears on a new session day
      consecutiveLosses = 0;
      consecutiveWins = 0;
    }

    // Manage open position exits
    if (open) {
      const resolved = resolveSameCandleExit({
        stop: open.stop,
        target: open.target,
        low: bar.low,
        high: bar.high,
        close: bar.close,
        isLastBar: i === bars.length - 1,
        stopFirst: assumptions.sameCandleStopFirst,
      });
      const exitPrice = resolved.exitPrice;
      const exitReason = resolved.exitReason ?? "signal";
      const collision = resolved.sameCandleCollision;

      if (exitPrice != null) {
        const slipPct = estimateSlippagePct(bar, bars.slice(0, i + 1), assumptions);
        const exitFill = exitPrice * (1 - slipPct); // sell slip
        const pnl =
          (exitFill - open.fillEntry) * open.qty -
          open.spreadCost -
          open.slippageCost -
          exitFill * (assumptions.feeBps / 10_000) * open.qty;
        const ret = (exitFill - open.fillEntry) / open.fillEntry;
        trades.push({
          id: newTradeId(),
          symbol: open.symbol,
          direction: "long",
          strategyVersion: open.strategyVersion,
          entryTime: open.entryTime,
          exitTime: bar.timestamp,
          plannedEntry: open.fillEntry,
          fillEntry: open.fillEntry,
          stopLoss: open.stop,
          takeProfit: open.target,
          exitPrice: exitFill,
          exitReason,
          qty: open.qty,
          notional: open.fillEntry * open.qty,
          realizedPnl: Number(pnl.toFixed(4)),
          returnPct: Number(ret.toFixed(6)),
          spreadCost: open.spreadCost,
          slippageCost: open.slippageCost + exitFill * slipPct * open.qty,
          holdingBars: i - open.entryIdx,
          regime: open.regime,
          confidence: open.confidence,
          sameCandleCollision: collision,
        });
        equity += pnl;
        realizedToday += pnl;
        if (pnl < 0) {
          consecutiveLosses += 1;
          consecutiveWins = 0;
        } else {
          consecutiveWins += 1;
          consecutiveLosses = 0;
        }
        open = null;
      }
    }

    if (i % step !== 0) continue;
    if (open) continue;
    if (tradesToday >= maxTrades) continue;
    if (maxOpen <= 0) continue;
    if (realizedToday < 0 && Math.abs(realizedToday) / assumptions.startingEquity >= maxDailyLossPct / 100) {
      continue;
    }

    const window = alpaca.slice(0, i + 1);
    const evalResult = evaluateStrategyAt({
      decisionTime: bar.timestamp,
      symbol: input.symbol,
      bars5Min: window,
      strategyVersion: input.strategyVersion,
      minConfidence: input.minConfidence,
      blockedRegimes: input.blockedRegimes,
      account: {
        equity,
        openPositionCount: 0,
        openSymbols: [],
        pendingEntrySymbols: [],
        marketOpen: true,
        minutesToClose: 120,
        minutesSinceOpen: 90,
        riskRuntime: {
          paperOnly: true,
          dayKey,
          consecutiveLosses,
          consecutiveWins,
          dailyRealizedPnL: realizedToday,
          dailyUnrealizedPnL: 0,
          entriesPaused: consecutiveLosses >= 3,
          pauseReason: consecutiveLosses >= 3 ? "consecutive losses" : null,
          lastReconciledAt: bar.timestamp,
          reconciliationComplete: true,
        },
        reconciliationComplete: true,
      },
    });

    if (
      evalResult.action !== "BUY" ||
      !evalResult.proposedEntry ||
      !evalResult.stopLoss ||
      !evalResult.takeProfit ||
      !evalResult.risk?.approved
    ) {
      continue;
    }

    const histWindow = bars.slice(0, i + 1);
    const spreadPct = estimateSpreadPct(bar, histWindow, assumptions);
    const slipPct = estimateSlippagePct(bar, histWindow, assumptions);
    const costs = applyEntryCosts(bar.close, "buy", spreadPct, slipPct);
    const qty = Math.max(1, Math.floor(evalResult.risk.qty || 1));
    const notional = costs.fill * qty;
    if (notional > equity * 0.25) continue;

    open = {
      symbol: input.symbol.toUpperCase(),
      entryIdx: i,
      entryTime: bar.timestamp,
      fillEntry: costs.fill,
      stop: evalResult.stopLoss,
      target: evalResult.takeProfit,
      qty,
      spreadCost: costs.spreadCost * qty,
      slippageCost: costs.slippageCost * qty,
      confidence: evalResult.confidence,
      regime: evalResult.regime,
      strategyVersion: evalResult.strategyVersion,
    };
    tradesToday += 1;
  }

  return { trades, assumptions };
}
