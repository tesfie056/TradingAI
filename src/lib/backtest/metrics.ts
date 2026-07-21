/**
 * Aggregate backtest metrics from simulated trades.
 */

import type { BacktestMetrics, SimTrade } from "@/lib/backtest/types";

function hourEt(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "na";
  }
}

function confBucket(c: number): string {
  if (c < 0.55) return "<0.55";
  if (c < 0.65) return "0.55-0.65";
  if (c < 0.75) return "0.65-0.75";
  return "≥0.75";
}

export function computeMetrics(
  trades: SimTrade[],
  startingEquity: number,
): BacktestMetrics {
  const pnls = trades.map((t) => t.realizedPnl);
  const rets = trades.map((t) => t.returnPct);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const totalTrades = trades.length;
  const winRate = totalTrades ? wins.length / totalTrades : null;
  const lossRate = totalTrades ? losses.length / totalTrades : null;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor =
    grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(4)) : null;
  const totalReturn = pnls.reduce((a, b) => a + b, 0);
  const avgReturnPerTrade =
    totalTrades > 0 ? totalReturn / totalTrades : null;
  const avgWinner = wins.length ? grossWin / wins.length : null;
  const avgLoser = losses.length ? -grossLoss / losses.length : null;
  const expectancy = avgReturnPerTrade;

  let equity = startingEquity;
  let peak = startingEquity;
  let maxDd = 0;
  const equityCurve: number[] = [];
  for (const p of pnls) {
    equity += p;
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const mean =
    rets.length > 0 ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const variance =
    rets.length > 1
      ? rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)
      : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? Number((mean / std).toFixed(4)) : null;
  const downside = rets.filter((r) => r < 0);
  const downVar =
    downside.length > 1
      ? downside.reduce((a, r) => a + r ** 2, 0) / (downside.length - 1)
      : 0;
  const downStd = Math.sqrt(downVar);
  const sortino = downStd > 0 ? Number((mean / downStd).toFixed(4)) : null;
  const calmar =
    maxDd > 0 ? Number((totalReturn / startingEquity / maxDd).toFixed(4)) : null;
  const recoveryFactor =
    maxDd > 0 && startingEquity > 0
      ? Number((totalReturn / (maxDd * startingEquity)).toFixed(4))
      : null;

  let cw = 0;
  let cl = 0;
  let maxCw = 0;
  let maxCl = 0;
  for (const p of pnls) {
    if (p > 0) {
      cw += 1;
      cl = 0;
      maxCw = Math.max(maxCw, cw);
    } else if (p < 0) {
      cl += 1;
      cw = 0;
      maxCl = Math.max(maxCl, cl);
    }
  }

  const spreadCostTotal = trades.reduce((a, t) => a + t.spreadCost, 0);
  const slippageCostTotal = trades.reduce((a, t) => a + t.slippageCost, 0);
  const beforeCosts = totalReturn + spreadCostTotal + slippageCostTotal;

  const bySymbol: BacktestMetrics["bySymbol"] = {};
  const byRegime: BacktestMetrics["byRegime"] = {};
  const byMonth: BacktestMetrics["byMonth"] = {};
  const byHourEt: BacktestMetrics["byHourEt"] = {};
  const byConfidence: BacktestMetrics["byConfidence"] = {};
  const symbolWins = new Map<string, number>();

  for (const t of trades) {
    const prev = bySymbol[t.symbol] ?? { trades: 0, pnl: 0, winRate: null };
    const wins = (symbolWins.get(t.symbol) ?? 0) + (t.realizedPnl > 0 ? 1 : 0);
    symbolWins.set(t.symbol, wins);
    const tradesN = prev.trades + 1;
    bySymbol[t.symbol] = {
      trades: tradesN,
      pnl: Number((prev.pnl + t.realizedPnl).toFixed(4)),
      winRate: wins / tradesN,
    };

    const r = byRegime[t.regime] ?? { trades: 0, pnl: 0 };
    byRegime[t.regime] = {
      trades: r.trades + 1,
      pnl: Number((r.pnl + t.realizedPnl).toFixed(4)),
    };

    const month = t.entryTime.slice(0, 7);
    const m = byMonth[month] ?? { trades: 0, pnl: 0 };
    byMonth[month] = {
      trades: m.trades + 1,
      pnl: Number((m.pnl + t.realizedPnl).toFixed(4)),
    };

    const hour = hourEt(t.entryTime);
    const h = byHourEt[hour] ?? { trades: 0, pnl: 0 };
    byHourEt[hour] = {
      trades: h.trades + 1,
      pnl: Number((h.pnl + t.realizedPnl).toFixed(4)),
    };

    const cb = confBucket(t.confidence);
    const c = byConfidence[cb] ?? { trades: 0, pnl: 0 };
    byConfidence[cb] = {
      trades: c.trades + 1,
      pnl: Number((c.pnl + t.realizedPnl).toFixed(4)),
    };
  }

  const statisticallyWeak = totalTrades < 30;
  return {
    totalTrades,
    winRate,
    lossRate,
    totalReturn: Number(totalReturn.toFixed(4)),
    avgReturnPerTrade:
      avgReturnPerTrade != null ? Number(avgReturnPerTrade.toFixed(4)) : null,
    avgWinner: avgWinner != null ? Number(avgWinner.toFixed(4)) : null,
    avgLoser: avgLoser != null ? Number(avgLoser.toFixed(4)) : null,
    profitFactor,
    expectancy: expectancy != null ? Number(expectancy.toFixed(4)) : null,
    maxDrawdown: Number(maxDd.toFixed(5)),
    sharpe,
    sortino,
    calmar,
    recoveryFactor,
    consecutiveWins: maxCw,
    consecutiveLosses: maxCl,
    avgHoldingBars:
      totalTrades > 0
        ? Number(
            (
              trades.reduce((a, t) => a + t.holdingBars, 0) / totalTrades
            ).toFixed(2),
          )
        : null,
    exposure: null,
    turnover: totalTrades > 0 ? Number((totalTrades / Math.max(1, equityCurve.length)).toFixed(4)) : null,
    spreadCostTotal: Number(spreadCostTotal.toFixed(4)),
    slippageCostTotal: Number(slippageCostTotal.toFixed(4)),
    totalReturnBeforeCosts: Number(beforeCosts.toFixed(4)),
    totalReturnAfterCosts: Number(totalReturn.toFixed(4)),
    bySymbol,
    byRegime,
    byMonth,
    byHourEt,
    byConfidence,
    statisticallyWeak,
    weakReason: statisticallyWeak
      ? `Only ${totalTrades} simulated trades — too few for strong conclusions.`
      : null,
  };
}
