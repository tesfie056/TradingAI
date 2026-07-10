import type { AlpacaBar } from "@/lib/alpaca/types";
import { analyzeStockTechnicals } from "@/lib/stocks/technicals";

export type MarketConditionLabel = "bullish" | "bearish" | "choppy" | "unclear";

export type MarketCondition = {
  label: MarketConditionLabel;
  /** 0–1 market score (higher = more bullish). */
  marketScore: number;
  spyTrendPct: number | null;
  qqqTrendPct: number | null;
  explanation: string;
  paperOnly: true;
};

function trendPct(bars: AlpacaBar[]): number | null {
  if (bars.length < 2) return null;
  const first = bars[0].c;
  const last = bars[bars.length - 1].c;
  if (!(first > 0)) return null;
  return (last - first) / first;
}

/**
 * Overall U.S. equity market direction from SPY + QQQ (stocks only).
 */
export function assessMarketCondition(input: {
  spyBars5Min?: AlpacaBar[];
  qqqBars5Min?: AlpacaBar[];
  spyBars15Min?: AlpacaBar[];
  qqqBars15Min?: AlpacaBar[];
}): MarketCondition {
  const spy5 = input.spyBars5Min ?? [];
  const qqq5 = input.qqqBars5Min ?? [];
  const spy15 = input.spyBars15Min ?? [];
  const qqq15 = input.qqqBars15Min ?? [];

  const spyTech = analyzeStockTechnicals({
    bars5Min: spy5,
    bars15Min: spy15,
    lastPrice: spy5.at(-1)?.c ?? spy15.at(-1)?.c ?? null,
  });
  const qqqTech = analyzeStockTechnicals({
    bars5Min: qqq5,
    bars15Min: qqq15,
    lastPrice: qqq5.at(-1)?.c ?? qqq15.at(-1)?.c ?? null,
  });

  const spyTrendPct =
    trendPct(spy15.length >= 2 ? spy15 : spy5) ?? spyTech.trends[1]?.trendPct;
  const qqqTrendPct =
    trendPct(qqq15.length >= 2 ? qqq15 : qqq5) ?? qqqTech.trends[1]?.trendPct;

  const lean = (spyTech.technicalLean + qqqTech.technicalLean) / 2;
  const avgTrend =
    spyTrendPct != null && qqqTrendPct != null
      ? (spyTrendPct + qqqTrendPct) / 2
      : (spyTrendPct ?? qqqTrendPct);

  let label: MarketConditionLabel = "unclear";
  if (
    spyTrendPct == null &&
    qqqTrendPct == null &&
    spy5.length < 2 &&
    qqq5.length < 2
  ) {
    label = "unclear";
  } else if (lean >= 1.2 && (avgTrend == null || avgTrend > 0)) {
    label = "bullish";
  } else if (lean <= -1.2 && (avgTrend == null || avgTrend < 0)) {
    label = "bearish";
  } else if (
    Math.abs(lean) < 0.6 ||
    (spyTech.trends[1]?.trendLabel === "up" &&
      qqqTech.trends[1]?.trendLabel === "down") ||
    (spyTech.trends[1]?.trendLabel === "down" &&
      qqqTech.trends[1]?.trendLabel === "up")
  ) {
    label = "choppy";
  } else if (lean > 0.4) {
    label = "bullish";
  } else if (lean < -0.4) {
    label = "bearish";
  } else {
    label = "choppy";
  }

  const marketScore = Number(
    Math.min(0.95, Math.max(0.05, 0.5 + lean / 6)).toFixed(3),
  );

  const spyTxt =
    spyTrendPct != null
      ? `SPY ${(spyTrendPct * 100).toFixed(2)}%`
      : "SPY n/a";
  const qqqTxt =
    qqqTrendPct != null
      ? `QQQ ${(qqqTrendPct * 100).toFixed(2)}%`
      : "QQQ n/a";

  const explanation =
    label === "bullish"
      ? `Market looks bullish (${spyTxt}, ${qqqTxt}). Favor longs only with strong stock signals.`
      : label === "bearish"
        ? `Market looks weak/bearish (${spyTxt}, ${qqqTxt}). Avoid new BUY ideas.`
        : label === "choppy"
          ? `Market is choppy/unclear (${spyTxt}, ${qqqTxt}). Prefer HOLD unless the stock signal is strong.`
          : `Market direction unclear (${spyTxt}, ${qqqTxt}). Stay defensive.`;

  return {
    label,
    marketScore,
    spyTrendPct,
    qqqTrendPct,
    explanation,
    paperOnly: true,
  };
}
