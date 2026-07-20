import type { AlpacaBar } from "@/lib/alpaca/types";

export type BarTimeframeLabel = "1Min" | "5Min" | "15Min";

export type TimeframeTrend = {
  timeframe: BarTimeframeLabel;
  trendPct: number | null;
  trendLabel: "up" | "down" | "flat" | "insufficient";
  barCount: number;
};

export type StockTechnicalAnalysis = {
  trends: TimeframeTrend[];
  /** Combined technical lean: positive = bullish, negative = bearish. */
  technicalLean: number;
  volumeRatio: number | null;
  volumeLabel: string;
  vwap: number | null;
  vwapBias: "above" | "below" | "near" | "unknown";
  support: number | null;
  resistance: number | null;
  nearSupport: boolean;
  nearResistance: boolean;
  rangePct: number | null;
  volatilityLabel: "compressed" | "normal" | "elevated" | "extreme" | "unknown";
  gapPct: number | null;
  gapLabel: "gap_up" | "gap_down" | "none" | "unknown";
  summary: string;
};

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function trendFromBars(
  bars: AlpacaBar[],
  timeframe: BarTimeframeLabel,
): TimeframeTrend {
  if (bars.length < 2) {
    return {
      timeframe,
      trendPct: null,
      trendLabel: "insufficient",
      barCount: bars.length,
    };
  }
  const first = bars[0].c;
  const last = bars[bars.length - 1].c;
  const trendPct = first > 0 ? (last - first) / first : null;
  let trendLabel: TimeframeTrend["trendLabel"] = "flat";
  if (trendPct == null) trendLabel = "insufficient";
  else if (trendPct > 0.0015) trendLabel = "up";
  else if (trendPct < -0.0015) trendLabel = "down";
  return { timeframe, trendPct, trendLabel, barCount: bars.length };
}

/** Session VWAP approximation from bar OHLCV (typical price * volume). */
export function computeVwap(bars: AlpacaBar[]): number | null {
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    if (!(b.v > 0)) continue;
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
  }
  if (vol <= 0) return null;
  return pv / vol;
}

export function analyzeVolume(bars: AlpacaBar[]): {
  volumeRatio: number | null;
  volumeLabel: string;
} {
  const volumes = bars.map((b) => b.v).filter((v) => v > 0);
  if (volumes.length < 4) {
    return { volumeRatio: null, volumeLabel: "Volume sample too small." };
  }
  const recent = volumes.slice(-3);
  const earlier = volumes.slice(0, -3);
  const base = earlier.length > 0 ? avg(earlier) : avg(volumes);
  const volumeRatio = base > 0 ? avg(recent) / base : null;
  if (volumeRatio == null) {
    return { volumeRatio: null, volumeLabel: "Volume ratio unavailable." };
  }
  if (volumeRatio >= 1.5) {
    return {
      volumeRatio,
      volumeLabel: `Volume is strong (${volumeRatio.toFixed(2)}x recent average).`,
    };
  }
  if (volumeRatio < 0.7) {
    return {
      volumeRatio,
      volumeLabel: `Volume is light (${volumeRatio.toFixed(2)}x recent average).`,
    };
  }
  return {
    volumeRatio,
    volumeLabel: `Volume is near average (${volumeRatio.toFixed(2)}x).`,
  };
}

export function estimateSupportResistance(bars: AlpacaBar[]): {
  support: number | null;
  resistance: number | null;
} {
  if (bars.length < 3) return { support: null, resistance: null };
  const lows = bars.map((b) => b.l);
  const highs = bars.map((b) => b.h);
  // Simple: recent swing low / high (exclude last bar for cleaner levels)
  const prior = bars.slice(0, -1);
  const support = Math.min(...prior.map((b) => b.l));
  const resistance = Math.max(...prior.map((b) => b.h));
  if (!(support > 0) || !(resistance > 0) || resistance < support) {
    return {
      support: Math.min(...lows),
      resistance: Math.max(...highs),
    };
  }
  return { support, resistance };
}

export function detectGap(bars: AlpacaBar[]): {
  gapPct: number | null;
  gapLabel: StockTechnicalAnalysis["gapLabel"];
} {
  if (bars.length < 2) return { gapPct: null, gapLabel: "unknown" };
  // Compare last bar open vs prior close (works on 5Min/15Min for session gaps
  // and also catches abrupt opens between bars).
  const prior = bars[bars.length - 2];
  const last = bars[bars.length - 1];
  if (!(prior.c > 0) || !(last.o > 0)) {
    return { gapPct: null, gapLabel: "unknown" };
  }
  const gapPct = (last.o - prior.c) / prior.c;
  if (gapPct >= 0.004) return { gapPct, gapLabel: "gap_up" };
  if (gapPct <= -0.004) return { gapPct, gapLabel: "gap_down" };
  return { gapPct, gapLabel: "none" };
}

export function analyzeStockTechnicals(input: {
  bars1Min?: AlpacaBar[];
  bars5Min?: AlpacaBar[];
  bars15Min?: AlpacaBar[];
  lastPrice: number | null;
}): StockTechnicalAnalysis {
  const bars1 = input.bars1Min ?? [];
  const bars5 = input.bars5Min ?? [];
  const bars15 = input.bars15Min ?? [];
  // Prefer 5Min for volume/VWAP/range; fall back to 15 then 1.
  const primary =
    bars5.length >= 3 ? bars5 : bars15.length >= 3 ? bars15 : bars1;

  const trends = [
    trendFromBars(bars1, "1Min"),
    trendFromBars(bars5, "5Min"),
    trendFromBars(bars15, "15Min"),
  ];

  let technicalLean = 0;
  const weights: Record<BarTimeframeLabel, number> = {
    "1Min": 0.8,
    "5Min": 1.4,
    "15Min": 1.2,
  };
  for (const t of trends) {
    if (t.trendLabel === "up") technicalLean += weights[t.timeframe];
    else if (t.trendLabel === "down") technicalLean -= weights[t.timeframe];
  }

  const { volumeRatio, volumeLabel } = analyzeVolume(primary);
  if (volumeRatio != null && volumeRatio >= 1.4) {
    if (technicalLean > 0) technicalLean += 0.6;
    else if (technicalLean < 0) technicalLean -= 0.6;
  }

  const vwap = computeVwap(primary);
  let vwapBias: StockTechnicalAnalysis["vwapBias"] = "unknown";
  if (vwap != null && input.lastPrice != null && input.lastPrice > 0) {
    const dist = (input.lastPrice - vwap) / vwap;
    if (dist > 0.0015) {
      vwapBias = "above";
      technicalLean += 0.4;
    } else if (dist < -0.0015) {
      vwapBias = "below";
      technicalLean -= 0.4;
    } else {
      vwapBias = "near";
    }
  }

  const { support, resistance } = estimateSupportResistance(primary);
  let nearSupport = false;
  let nearResistance = false;
  if (input.lastPrice != null && input.lastPrice > 0) {
    if (support != null && (input.lastPrice - support) / input.lastPrice < 0.004) {
      nearSupport = true;
    }
    if (
      resistance != null &&
      (resistance - input.lastPrice) / input.lastPrice < 0.004
    ) {
      nearResistance = true;
    }
  }

  let rangePct: number | null = null;
  if (primary.length >= 2) {
    const high = Math.max(...primary.map((b) => b.h));
    const low = Math.min(...primary.map((b) => b.l));
    const mid = (high + low) / 2 || input.lastPrice || 0;
    rangePct = mid > 0 ? (high - low) / mid : null;
  }

  let volatilityLabel: StockTechnicalAnalysis["volatilityLabel"] = "unknown";
  if (rangePct != null) {
    if (rangePct > 0.04) volatilityLabel = "extreme";
    else if (rangePct > 0.025) volatilityLabel = "elevated";
    else if (rangePct < 0.004) volatilityLabel = "compressed";
    else volatilityLabel = "normal";
  }

  const { gapPct, gapLabel } = detectGap(primary.length >= 2 ? primary : bars5);
  if (gapLabel === "gap_up") technicalLean += 0.35;
  if (gapLabel === "gap_down") technicalLean -= 0.35;

  const trendBits = trends
    .map((t) => {
      if (t.trendLabel === "insufficient") return `${t.timeframe}: n/a`;
      const pct =
        t.trendPct != null ? ` ${(t.trendPct * 100).toFixed(2)}%` : "";
      return `${t.timeframe}: ${t.trendLabel}${pct}`;
    })
    .join("; ");

  const summary = [
    trendBits,
    volumeLabel,
    vwap != null
      ? `VWAP $${vwap.toFixed(2)} (price ${vwapBias}).`
      : "VWAP unavailable.",
    support != null && resistance != null
      ? `Support ~$${support.toFixed(2)}, resistance ~$${resistance.toFixed(2)}.`
      : "Support/resistance unclear.",
    rangePct != null
      ? `Range ${(rangePct * 100).toFixed(2)}% (${volatilityLabel}).`
      : "Range unknown.",
    gapLabel === "gap_up"
      ? `Gap up ${(gapPct! * 100).toFixed(2)}%.`
      : gapLabel === "gap_down"
        ? `Gap down ${(Math.abs(gapPct!) * 100).toFixed(2)}%.`
        : "No meaningful gap.",
  ].join(" ");

  return {
    trends,
    technicalLean,
    volumeRatio,
    volumeLabel,
    vwap,
    vwapBias,
    support,
    resistance,
    nearSupport,
    nearResistance,
    rangePct,
    volatilityLabel,
    gapPct,
    gapLabel,
    summary,
  };
}

/** Simple moving average of closes. Requires `period` closes. */
export function simpleMovingAverage(
  closes: number[],
  period: number,
): number | null {
  if (period < 1 || closes.length < period) return null;
  const slice = closes.slice(-period);
  if (slice.some((c) => !(c > 0))) return null;
  return slice.reduce((a, b) => a + b, 0) / period;
}

export type MaAlignment = {
  fastMa: number | null;
  slowMa: number | null;
  priceAboveBoth: boolean;
  fastAboveSlow: boolean;
  slopeFast: number | null;
  slopeSlow: number | null;
  barCount: number;
};

/**
 * Fast/slow SMA alignment from bar closes.
 * Slope = (current MA - prior MA) / prior MA using one extra bar when available.
 */
export function computeMaAlignment(
  bars: AlpacaBar[],
  fastPeriod: number,
  slowPeriod: number,
): MaAlignment {
  const closes = bars.map((b) => b.c).filter((c) => c > 0);
  const need = Math.max(fastPeriod, slowPeriod) + 1;
  if (closes.length < Math.max(fastPeriod, slowPeriod)) {
    return {
      fastMa: null,
      slowMa: null,
      priceAboveBoth: false,
      fastAboveSlow: false,
      slopeFast: null,
      slopeSlow: null,
      barCount: closes.length,
    };
  }
  const fastMa = simpleMovingAverage(closes, fastPeriod);
  const slowMa = simpleMovingAverage(closes, slowPeriod);
  const price = closes[closes.length - 1] ?? null;
  const priceAboveBoth =
    price != null &&
    fastMa != null &&
    slowMa != null &&
    price > fastMa &&
    price > slowMa;
  const fastAboveSlow =
    fastMa != null && slowMa != null && fastMa > slowMa;

  let slopeFast: number | null = null;
  let slopeSlow: number | null = null;
  if (closes.length >= need) {
    const prior = closes.slice(0, -1);
    const prevFast = simpleMovingAverage(prior, fastPeriod);
    const prevSlow = simpleMovingAverage(prior, slowPeriod);
    if (prevFast != null && prevFast > 0 && fastMa != null) {
      slopeFast = (fastMa - prevFast) / prevFast;
    }
    if (prevSlow != null && prevSlow > 0 && slowMa != null) {
      slopeSlow = (slowMa - prevSlow) / prevSlow;
    }
  }

  return {
    fastMa,
    slowMa,
    priceAboveBoth,
    fastAboveSlow,
    slopeFast,
    slopeSlow,
    barCount: closes.length,
  };
}

/** Map technical lean to a 0–1 technical score (0.5 = neutral). */
export function technicalLeanToScore(lean: number): number {
  // lean roughly in [-4, 4]
  const score = 0.5 + lean / 8;
  return Math.min(0.95, Math.max(0.05, Number(score.toFixed(3))));
}
