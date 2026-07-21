/**
 * Feature snapshot builder — decision-time only, no lookahead.
 */

import { createHash } from "node:crypto";
import type { AlpacaBar, AlpacaQuote } from "@/lib/alpaca/types";
import { classifyMarketRegime } from "@/lib/learning/regime";
import type {
  LearningFeatureSnapshot,
  LearningFeatureVector,
  MarketSession,
} from "@/lib/learning/types";
import {
  analyzeStockTechnicals,
  computeVwap,
} from "@/lib/stocks/technicals";

function barTimeMs(t: string): number {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : 0;
}

/** Keep only bars with timestamp ≤ decisionTime (strict no-lookahead). */
export function filterBarsAsOf(
  bars: AlpacaBar[],
  decisionTimeIso: string,
): AlpacaBar[] {
  const cutoff = Date.parse(decisionTimeIso);
  if (!Number.isFinite(cutoff)) return [];
  return bars.filter((b) => barTimeMs(b.t) <= cutoff);
}

export function computeAtr(
  bars: AlpacaBar[],
  period = 14,
): { atr: number | null; atrPct: number | null } {
  if (bars.length < period + 1) return { atr: null, atrPct: null };
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i]!;
    const prev = bars[i - 1]!;
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c),
    );
    trs.push(tr);
  }
  if (trs.length < period) return { atr: null, atrPct: null };
  const slice = trs.slice(-period);
  const atr = slice.reduce((a, b) => a + b, 0) / period;
  const lastClose = bars[bars.length - 1]?.c ?? 0;
  const atrPct = lastClose > 0 ? atr / lastClose : null;
  return { atr, atrPct };
}

export function computeRsi(bars: AlpacaBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const diff = bars[i]!.c - bars[i - 1]!.c;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return Number((100 - 100 / (1 + rs)).toFixed(4));
}

export function computeMacd(bars: AlpacaBar[]): {
  macdLine: number | null;
  macdSignal: number | null;
  macdHist: number | null;
} {
  if (bars.length < 35) {
    return { macdLine: null, macdSignal: null, macdHist: null };
  }
  const closes = bars.map((b) => b.c);
  function ema(period: number, data: number[]): number[] {
    const k = 2 / (period + 1);
    const out: number[] = [];
    let prev = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = prev;
    for (let i = period; i < data.length; i++) {
      prev = data[i]! * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }
  const ema12 = ema(12, closes);
  const ema26 = ema(26, closes);
  const macdSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] == null || ema26[i] == null) {
      macdSeries.push(NaN);
      continue;
    }
    macdSeries.push(ema12[i]! - ema26[i]!);
  }
  const validMacd = macdSeries.map((v) => (Number.isFinite(v) ? v : 0));
  const signalArr = ema(9, validMacd);
  const last = closes.length - 1;
  const macdLine = Number.isFinite(macdSeries[last]!)
    ? Number(macdSeries[last]!.toFixed(6))
    : null;
  const macdSignal =
    signalArr[last] != null ? Number(signalArr[last]!.toFixed(6)) : null;
  const macdHist =
    macdLine != null && macdSignal != null
      ? Number((macdLine - macdSignal).toFixed(6))
      : null;
  return { macdLine, macdSignal, macdHist };
}

function sma(bars: AlpacaBar[], period: number): number | null {
  if (bars.length < period) return null;
  const slice = bars.slice(-period);
  return slice.reduce((a, b) => a + b.c, 0) / period;
}

function recentReturn(bars: AlpacaBar[], n: number): number | null {
  if (bars.length < n + 1) return null;
  const last = bars[bars.length - 1]!.c;
  const prev = bars[bars.length - 1 - n]!.c;
  if (!(prev > 0)) return null;
  return (last - prev) / prev;
}

function hashFeatures(features: LearningFeatureVector): string {
  const payload = JSON.stringify(features);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function newSnapshotId(): string {
  return `fs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function inferMarketSession(
  isMarketOpen: boolean | null | undefined,
): MarketSession {
  if (isMarketOpen === true) return "regular";
  if (isMarketOpen === false) return "closed";
  return "unknown";
}

export type BuildFeatureSnapshotInput = {
  decisionId: string;
  symbol: string;
  decisionTime: string;
  strategyId: string;
  strategyVersion: string;
  confidence: number | null;
  quote?: AlpacaQuote | null;
  bars1Min?: AlpacaBar[];
  bars5Min?: AlpacaBar[];
  bars15Min?: AlpacaBar[];
  spyBars?: AlpacaBar[];
  qqqBars?: AlpacaBar[];
  isMarketOpen?: boolean | null;
  sector?: string | null;
  avgDailyVolume?: number | null;
  broaderMarketDirection?: string | null;
};

/**
 * Build a leakage-safe feature snapshot.
 * Future bars in the input arrays are ignored via filterBarsAsOf.
 */
export function buildFeatureSnapshot(
  input: BuildFeatureSnapshotInput,
): LearningFeatureSnapshot {
  const decisionTime = input.decisionTime;
  const flags: string[] = [];

  const b1 = filterBarsAsOf(input.bars1Min ?? [], decisionTime);
  const b5 = filterBarsAsOf(input.bars5Min ?? [], decisionTime);
  const b15 = filterBarsAsOf(input.bars15Min ?? [], decisionTime);
  const spy = filterBarsAsOf(input.spyBars ?? [], decisionTime);
  const qqq = filterBarsAsOf(input.qqqBars ?? [], decisionTime);

  const primary = b5.length >= 3 ? b5 : b15.length >= 3 ? b15 : b1;
  if (primary.length < 5) flags.push("insufficient_bars");

  const lastBar = primary[primary.length - 1];
  const asOfBarTime = lastBar?.t ?? null;
  if (asOfBarTime && Date.parse(asOfBarTime) > Date.parse(decisionTime)) {
    flags.push("lookahead_guard_triggered");
  }

  const technicals = analyzeStockTechnicals({
    bars1Min: b1,
    bars5Min: b5,
    bars15Min: b15,
    lastPrice: lastBar?.c ?? input.quote?.bid ?? null,
  });

  const { atr, atrPct } = computeAtr(primary);
  const rsi = computeRsi(primary);
  const macd = computeMacd(primary);
  const smaFast = sma(primary, 10);
  const smaSlow = sma(primary, 20);
  const price = lastBar?.c ?? null;
  const priceVsSmaFast =
    price != null && smaFast != null && smaFast > 0
      ? (price - smaFast) / smaFast
      : null;

  const dayHigh = primary.length
    ? Math.max(...primary.map((b) => b.h))
    : null;
  const dayLow = primary.length ? Math.min(...primary.map((b) => b.l)) : null;
  const distFromDayHighPct =
    price != null && dayHigh != null && dayHigh > 0
      ? (dayHigh - price) / dayHigh
      : null;
  const distFromDayLowPct =
    price != null && dayLow != null && dayLow > 0
      ? (price - dayLow) / dayLow
      : null;

  let spyTrendPct: number | null = null;
  if (spy.length >= 2) {
    const a = spy[0]!.c;
    const z = spy[spy.length - 1]!.c;
    spyTrendPct = a > 0 ? (z - a) / a : null;
  }
  let qqqTrendPct: number | null = null;
  if (qqq.length >= 2) {
    const a = qqq[0]!.c;
    const z = qqq[qqq.length - 1]!.c;
    qqqTrendPct = a > 0 ? (z - a) / a : null;
  }
  const broadTrendPct =
    spyTrendPct != null && qqqTrendPct != null
      ? (spyTrendPct + qqqTrendPct) / 2
      : (spyTrendPct ?? qqqTrendPct);

  const quote = input.quote;
  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  let spreadPct: number | null = null;
  if (bid != null && ask != null && bid > 0 && ask >= bid) {
    const mid = (bid + ask) / 2;
    spreadPct = mid > 0 ? (ask - bid) / mid : null;
  }

  const lastVol = lastBar?.v ?? null;
  const avgVol =
    primary.length >= 5
      ? primary.slice(0, -1).reduce((s, b) => s + b.v, 0) /
        Math.max(1, primary.length - 1)
      : null;

  const features: LearningFeatureVector = {
    currentPrice: price,
    bid,
    ask,
    spreadPct,
    volume: lastVol,
    avgDailyVolume: input.avgDailyVolume ?? avgVol,
    relativeVolume: technicals.volumeRatio,
    volatilityRangePct: technicals.rangePct,
    atr,
    atrPct,
    trendLean: technicals.technicalLean,
    trend1mPct: technicals.trends.find((t) => t.timeframe === "1Min")?.trendPct ?? null,
    trend5mPct: technicals.trends.find((t) => t.timeframe === "5Min")?.trendPct ?? null,
    trend15mPct:
      technicals.trends.find((t) => t.timeframe === "15Min")?.trendPct ?? null,
    momentumScore: technicals.technicalLean,
    smaFast,
    smaSlow,
    priceVsSmaFast,
    rsi,
    macdLine: macd.macdLine,
    macdSignal: macd.macdSignal,
    macdHist: macd.macdHist,
    vwap: technicals.vwap ?? computeVwap(primary),
    vwapBias: technicals.vwapBias,
    recentReturn5: recentReturn(primary, 5),
    recentReturn20: recentReturn(primary, 20),
    gapPct: technicals.gapPct,
    distFromDayHighPct,
    distFromDayLowPct,
    sector: input.sector ?? null,
    broaderMarketDirection: input.broaderMarketDirection ?? null,
    spyTrendPct,
    qqqTrendPct,
  };

  if (rsi == null) flags.push("rsi_unavailable");
  if (macd.macdLine == null) flags.push("macd_unavailable");
  if (atr == null) flags.push("atr_unavailable");

  const { regime, inputs: regimeInputs } = classifyMarketRegime({
    broadTrendPct,
    atrPct,
    rangePct: technicals.rangePct,
    relativeVolume: technicals.volumeRatio,
    trendStrength: technicals.technicalLean,
    vwapBias: technicals.vwapBias,
    priceVsSmaFast,
  });

  return {
    id: newSnapshotId(),
    decisionId: input.decisionId,
    symbol: input.symbol.toUpperCase(),
    decisionTime,
    asOfBarTime,
    marketSession: inferMarketSession(input.isMarketOpen),
    regime,
    regimeInputs,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    confidence: input.confidence,
    features,
    featureHash: hashFeatures(features),
    dataQualityFlags: flags,
    paperOnly: true,
  };
}

/**
 * Prove lookahead protection: features at t ignore bars after t.
 */
export function assertNoLookaheadInFeatures(
  allBars: AlpacaBar[],
  decisionTime: string,
): LearningFeatureVector {
  const snap = buildFeatureSnapshot({
    decisionId: "lookahead_test",
    symbol: "TEST",
    decisionTime,
    strategyId: "test",
    strategyVersion: "v0",
    confidence: 0.5,
    bars5Min: allBars,
  });
  const cutoff = Date.parse(decisionTime);
  for (const b of allBars) {
    if (barTimeMs(b.t) > cutoff && snap.asOfBarTime) {
      if (Date.parse(snap.asOfBarTime) > cutoff) {
        throw new Error("Lookahead: asOfBarTime after decisionTime");
      }
    }
  }
  return snap.features;
}
