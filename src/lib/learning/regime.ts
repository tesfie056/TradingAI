/**
 * Deterministic market-regime classifier.
 * No LLM — numerical rules only.
 */

export type MarketRegime =
  | "trending_up"
  | "trending_down"
  | "range_bound"
  | "high_volatility"
  | "low_volatility"
  | "high_volume_momentum"
  | "weak_uncertain";

export type RegimeClassifierInput = {
  /** Combined SPY/QQQ style trend (positive = up). */
  broadTrendPct: number | null;
  atrPct: number | null;
  rangePct: number | null;
  relativeVolume: number | null;
  trendStrength: number | null;
  vwapBias: "above" | "below" | "near" | "unknown";
  priceVsSmaFast: number | null;
};

/**
 * Priority (first match wins after high-vol / high-volume checks):
 * 1. high_volatility
 * 2. high_volume_momentum
 * 3. trending_up / trending_down
 * 4. low_volatility + range_bound
 * 5. range_bound
 * 6. weak_uncertain
 */
export function classifyMarketRegime(
  input: RegimeClassifierInput,
): { regime: MarketRegime; inputs: Record<string, number | string | boolean | null> } {
  const atrPct = input.atrPct;
  const rangePct = input.rangePct;
  const relVol = input.relativeVolume;
  const trend = input.broadTrendPct;
  const strength = input.trendStrength;

  const volProxy =
    atrPct != null ? atrPct : rangePct != null ? rangePct : null;

  const serialized: Record<string, number | string | boolean | null> = {
    broadTrendPct: trend,
    atrPct,
    rangePct,
    relativeVolume: relVol,
    trendStrength: strength,
    vwapBias: input.vwapBias,
    priceVsSmaFast: input.priceVsSmaFast,
  };

  if (volProxy != null && volProxy >= 0.035) {
    return { regime: "high_volatility", inputs: serialized };
  }

  if (
    relVol != null &&
    relVol >= 1.6 &&
    trend != null &&
    Math.abs(trend) >= 0.004
  ) {
    return { regime: "high_volume_momentum", inputs: serialized };
  }

  if (
    trend != null &&
    strength != null &&
    Math.abs(trend) >= 0.003 &&
    Math.abs(strength) >= 1.2
  ) {
    if (trend > 0) return { regime: "trending_up", inputs: serialized };
    return { regime: "trending_down", inputs: serialized };
  }

  if (volProxy != null && volProxy <= 0.006) {
    if (trend == null || Math.abs(trend) < 0.002) {
      return { regime: "low_volatility", inputs: serialized };
    }
  }

  if (
    (trend == null || Math.abs(trend) < 0.0025) &&
    (volProxy == null || volProxy < 0.025)
  ) {
    return { regime: "range_bound", inputs: serialized };
  }

  if (trend != null && Math.abs(trend) >= 0.0025) {
    return {
      regime: trend > 0 ? "trending_up" : "trending_down",
      inputs: serialized,
    };
  }

  return { regime: "weak_uncertain", inputs: serialized };
}

export function regimeLabel(regime: MarketRegime): string {
  switch (regime) {
    case "trending_up":
      return "Trending up";
    case "trending_down":
      return "Trending down";
    case "range_bound":
      return "Range-bound";
    case "high_volatility":
      return "High volatility";
    case "low_volatility":
      return "Low volatility";
    case "high_volume_momentum":
      return "High-volume momentum";
    case "weak_uncertain":
      return "Weak / uncertain";
    default:
      return regime;
  }
}
