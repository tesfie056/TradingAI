/**
 * Paper Intelligence v1 weakness analysis from real historical trades.
 * Enforces minimum sample sizes — no rule changes from tiny samples.
 */

import type { BacktestRunRecord, SimTrade } from "@/lib/backtest/types";

export type WeaknessFinding = {
  id: string;
  category:
    | "symbol"
    | "regime"
    | "time_of_day"
    | "confidence"
    | "cost"
    | "holding"
    | "stops"
    | "month"
    | "walk_forward";
  label: string;
  sampleSize: number;
  expectancy: number | null;
  profitFactor: number | null;
  drawdownHint: number | null;
  enoughEvidence: boolean;
  minSampleRequired: number;
  detail: string;
};

const MIN = 15;

function bucketStats(trades: SimTrade[]): {
  n: number;
  expectancy: number | null;
  profitFactor: number | null;
  pnl: number;
} {
  const n = trades.length;
  if (!n) return { n: 0, expectancy: null, profitFactor: null, pnl: 0 };
  const pnl = trades.reduce((a, t) => a + t.realizedPnl, 0);
  const wins = trades.filter((t) => t.realizedPnl > 0);
  const losses = trades.filter((t) => t.realizedPnl < 0);
  const gw = wins.reduce((a, t) => a + t.realizedPnl, 0);
  const gl = Math.abs(losses.reduce((a, t) => a + t.realizedPnl, 0));
  return {
    n,
    expectancy: pnl / n,
    profitFactor: gl > 0 ? gw / gl : null,
    pnl,
  };
}

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

export function buildWeaknessReport(
  run: BacktestRunRecord,
): {
  runId: string;
  strategyVersion: string;
  fingerprintHash: string | null;
  findings: WeaknessFinding[];
  actionableFindings: WeaknessFinding[];
  note: string;
} {
  const trades = run.trades;
  const findings: WeaknessFinding[] = [];

  const bySymbol = new Map<string, SimTrade[]>();
  const byRegime = new Map<string, SimTrade[]>();
  const byHour = new Map<string, SimTrade[]>();
  const byConf = new Map<string, SimTrade[]>();
  const byMonth = new Map<string, SimTrade[]>();

  for (const t of trades) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
    if (!byRegime.has(t.regime)) byRegime.set(t.regime, []);
    byRegime.get(t.regime)!.push(t);
    const h = hourEt(t.entryTime);
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(t);
    const cb = confBucket(t.confidence);
    if (!byConf.has(cb)) byConf.set(cb, []);
    byConf.get(cb)!.push(t);
    const m = t.entryTime.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(t);
  }

  const pushNeg = (
    category: WeaknessFinding["category"],
    label: string,
    list: SimTrade[],
    id: string,
  ) => {
    const s = bucketStats(list);
    if (s.n === 0) return;
    if ((s.expectancy ?? 0) >= 0) return;
    findings.push({
      id,
      category,
      label,
      sampleSize: s.n,
      expectancy: s.expectancy,
      profitFactor: s.profitFactor,
      drawdownHint: null,
      enoughEvidence: s.n >= MIN,
      minSampleRequired: MIN,
      detail:
        s.n < MIN
          ? `Only ${s.n} trades — do not change rules yet.`
          : `Negative expectancy with n=${s.n}.`,
    });
  };

  for (const [k, list] of bySymbol) {
    pushNeg("symbol", `Symbol ${k}`, list, `sym_${k}`);
  }
  for (const [k, list] of byRegime) {
    pushNeg("regime", `Regime ${k}`, list, `reg_${k}`);
  }
  for (const [k, list] of byHour) {
    pushNeg("time_of_day", `Hour ET ${k}`, list, `hour_${k}`);
  }
  for (const [k, list] of byConf) {
    pushNeg("confidence", `Confidence ${k}`, list, `conf_${k}`);
  }
  for (const [k, list] of byMonth) {
    pushNeg("month", `Month ${k}`, list, `month_${k}`);
  }

  const highCost = trades.filter(
    (t) => t.spreadCost + t.slippageCost > Math.abs(t.realizedPnl) * 0.5,
  );
  const hc = bucketStats(highCost);
  if (hc.n >= 5) {
    findings.push({
      id: "cost_sensitive_trades",
      category: "cost",
      label: "Trades where costs dominate P&L",
      sampleSize: hc.n,
      expectancy: hc.expectancy,
      profitFactor: hc.profitFactor,
      drawdownHint: null,
      enoughEvidence: hc.n >= MIN,
      minSampleRequired: MIN,
      detail: `${hc.n} trades with spread+slippage > 50% of |PnL| magnitude.`,
    });
  }

  const longHold = trades.filter((t) => t.holdingBars >= 60);
  const lh = bucketStats(longHold);
  if (lh.n >= 5) {
    findings.push({
      id: "long_holding",
      category: "holding",
      label: "Long holding periods (≥60 bars)",
      sampleSize: lh.n,
      expectancy: lh.expectancy,
      profitFactor: lh.profitFactor,
      drawdownHint: null,
      enoughEvidence: lh.n >= MIN,
      minSampleRequired: MIN,
      detail: `Avg hold among these: ${(longHold.reduce((a, t) => a + t.holdingBars, 0) / Math.max(1, lh.n)).toFixed(1)} bars`,
    });
  }

  const stops = trades.filter((t) => t.exitReason === "stop");
  const st = bucketStats(stops);
  if (st.n >= 5) {
    findings.push({
      id: "frequent_stops",
      category: "stops",
      label: "Stop-out exits",
      sampleSize: st.n,
      expectancy: st.expectancy,
      profitFactor: st.profitFactor,
      drawdownHint: null,
      enoughEvidence: st.n >= MIN,
      minSampleRequired: MIN,
      detail: `${((st.n / Math.max(1, trades.length)) * 100).toFixed(1)}% of trades exited via stop`,
    });
  }

  const failedFolds = run.folds.filter((f) => !f.passed);
  if (failedFolds.length > 0) {
    findings.push({
      id: "walk_forward_failures",
      category: "walk_forward",
      label: "Walk-forward fold failures",
      sampleSize: failedFolds.length,
      expectancy: null,
      profitFactor: null,
      drawdownHint: null,
      enoughEvidence: run.folds.length >= 5,
      minSampleRequired: 5,
      detail: `${failedFolds.length}/${run.folds.length} folds failed thresholds`,
    });
  }

  const actionableFindings = findings.filter((f) => f.enoughEvidence);
  return {
    runId: run.id,
    strategyVersion: run.strategyVersion,
    fingerprintHash: run.runFingerprint?.hash ?? null,
    findings,
    actionableFindings,
    note: "Do not recommend rule changes from findings with insufficient sample size. Not a profitability claim.",
  };
}
