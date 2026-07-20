/**
 * Derive daily metrics from counted trades + open/pending lifecycle state.
 */

import { classifyRealizedPnL } from "@/lib/trading/v1-daily/classify";
import type {
  V1CountedTradeSummary,
  V1DailySession,
} from "@/lib/trading/v1-daily/types";
import type { V1LifecycleTrade } from "@/lib/trading/v1-lifecycle/types";
import { isOpenManagedState } from "@/lib/trading/v1-lifecycle/transitions";

export function summarizeCountedTrades(trades: V1CountedTradeSummary[]): {
  wins: number;
  losses: number;
  breakeven: number;
  grossRealizedPnL: number;
  fees: number | null;
  netRealizedPnL: number;
  averageProfitPerCompletedTrade: number | null;
  averageLossPerLosingTrade: number | null;
  largestWinningTrade: number | null;
  largestLosingTrade: number | null;
  consecutiveWins: number;
  consecutiveLosses: number;
  lastCompletedTradeAt: string | null;
} {
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let gross = 0;
  let feeSum = 0;
  let feeKnown = false;
  let net = 0;
  const lossValues: number[] = [];
  let largestWin: number | null = null;
  let largestLoss: number | null = null;

  const ordered = [...trades].sort(
    (a, b) => Date.parse(a.exitFilledAt) - Date.parse(b.exitFilledAt),
  );

  for (const t of ordered) {
    const { pnlClass, pnlUsed } = classifyRealizedPnL({
      realizedNetPnL: t.realizedNetPnL,
      realizedGrossPnL: t.realizedGrossPnL,
    });
    if (pnlClass === "win") wins += 1;
    else if (pnlClass === "loss") losses += 1;
    else breakeven += 1;

    if (t.realizedGrossPnL != null) gross += t.realizedGrossPnL;
    if (t.realizedNetPnL != null) net += t.realizedNetPnL;
    else if (t.realizedGrossPnL != null) net += t.realizedGrossPnL;
    if (t.fees != null) {
      feeSum += t.fees;
      feeKnown = true;
    }

    if (pnlUsed != null && pnlClass === "win") {
      largestWin = largestWin == null ? pnlUsed : Math.max(largestWin, pnlUsed);
    }
    if (pnlUsed != null && pnlClass === "loss") {
      lossValues.push(pnlUsed);
      largestLoss =
        largestLoss == null ? pnlUsed : Math.min(largestLoss, pnlUsed);
    }
  }

  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const c = classifyRealizedPnL({
      realizedNetPnL: ordered[i].realizedNetPnL,
      realizedGrossPnL: ordered[i].realizedGrossPnL,
    }).pnlClass;
    if (i === ordered.length - 1) {
      if (c === "win") consecutiveWins = 1;
      else if (c === "loss") consecutiveLosses = 1;
      else break;
      continue;
    }
    if (consecutiveWins > 0 && c === "win") consecutiveWins += 1;
    else if (consecutiveLosses > 0 && c === "loss") consecutiveLosses += 1;
    else break;
  }

  const completed = ordered.length;
  return {
    wins,
    losses,
    breakeven,
    grossRealizedPnL: Number(gross.toFixed(4)),
    fees: feeKnown ? Number(feeSum.toFixed(4)) : null,
    netRealizedPnL: Number(net.toFixed(4)),
    averageProfitPerCompletedTrade:
      completed > 0 ? Number((net / completed).toFixed(4)) : null,
    averageLossPerLosingTrade:
      lossValues.length > 0
        ? Number(
            (
              lossValues.reduce((a, b) => a + b, 0) / lossValues.length
            ).toFixed(4),
          )
        : null,
    largestWinningTrade: largestWin,
    largestLosingTrade: largestLoss,
    consecutiveWins,
    consecutiveLosses,
    lastCompletedTradeAt: ordered.at(-1)?.exitFilledAt ?? null,
  };
}

export function partitionActiveTrades(trades: V1LifecycleTrade[]): {
  openTradeIds: string[];
  pendingTradeIds: string[];
  openV1Trades: number;
  pendingEntries: number;
  pendingExits: number;
  filledEntriesToday: number;
} {
  const openTradeIds: string[] = [];
  const pendingTradeIds: string[] = [];
  let pendingEntries = 0;
  let pendingExits = 0;
  let openV1Trades = 0;
  let filledEntriesToday = 0;

  for (const t of trades) {
    if (t.ownership !== "v1_managed") continue;
    if (t.lifecycleState === "COMPLETED" || t.lifecycleState === "ENTRY_REJECTED") {
      continue;
    }
    if (
      ["ENTRY_PENDING", "ENTRY_ACCEPTED", "ENTRY_PARTIALLY_FILLED"].includes(
        t.lifecycleState,
      )
    ) {
      pendingEntries += 1;
      pendingTradeIds.push(t.tradeId);
    }
    if (
      ["EXIT_PENDING", "EXIT_ACCEPTED", "EXIT_PARTIALLY_FILLED"].includes(
        t.lifecycleState,
      )
    ) {
      pendingExits += 1;
      pendingTradeIds.push(t.tradeId);
    }
    if (isOpenManagedState(t.lifecycleState) && t.remainingQty > 0) {
      openV1Trades += 1;
      openTradeIds.push(t.tradeId);
    }
    if (t.filledEntryQty > 0) filledEntriesToday += 1;
  }

  return {
    openTradeIds: [...new Set(openTradeIds)],
    pendingTradeIds: [...new Set(pendingTradeIds)],
    openV1Trades,
    pendingEntries,
    pendingExits,
    filledEntriesToday,
  };
}

export function applyProgressFields(
  session: V1DailySession,
  target: number,
  maxTrades: number,
): V1DailySession {
  const completed = session.completedTradesToday;
  return {
    ...session,
    dailyCompletedTradeTarget: target,
    maxTradesPerDay: maxTrades,
    remainingToTarget: Math.max(0, target - completed),
    targetReached: completed >= target,
    maxTradesReached: session.entryAttemptsToday >= maxTrades,
  };
}
