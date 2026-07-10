import type {
  AiNewsInterpretation,
  NewsAiProvider,
} from "@/lib/ai/types";
import type { NewsImportance, NewsItem, NewsSentiment } from "@/lib/news/types";

const IMPORTANCE_WEIGHT: Record<NewsImportance, number> = {
  low: 0.35,
  medium: 0.7,
  high: 1,
};

const SENTIMENT_VALUE: Record<NewsSentiment, number> = {
  positive: 1,
  neutral: 0,
  negative: -1,
};

/**
 * Keyword / aggregate heuristic interpreter (no network).
 */
export class HeuristicNewsAiProvider implements NewsAiProvider {
  readonly name = "heuristic" as const;

  async interpretSymbolNews(input: {
    symbol: string;
    headlines: Array<{
      headline: string;
      source: string;
      summary: string;
      sentiment?: NewsSentiment;
      importance?: NewsImportance;
      possibleMarketImpact?: string;
    }>;
  }): Promise<AiNewsInterpretation> {
    const items = input.headlines;
    if (items.length === 0) {
      return {
        sentiment: "neutral",
        importance: "low",
        shortTermImpact: "No headlines to interpret.",
        riskWarning: "Insufficient news context.",
        explanation:
          "No recent news items — decisions rely on market data only.",
        sentimentScore: 0,
      };
    }

    let weighted = 0;
    let weightSum = 0;
    let highestImportance: NewsImportance = "low";

    for (const item of items) {
      const sentiment = item.sentiment ?? "neutral";
      const importance = item.importance ?? "low";
      const w = IMPORTANCE_WEIGHT[importance];
      weighted += SENTIMENT_VALUE[sentiment] * w;
      weightSum += w;
      if (IMPORTANCE_WEIGHT[importance] > IMPORTANCE_WEIGHT[highestImportance]) {
        highestImportance = importance;
      }
    }

    const sentimentScore =
      weightSum > 0 ? Math.max(-1, Math.min(1, weighted / weightSum)) : 0;

    let sentiment: NewsSentiment = "neutral";
    if (sentimentScore >= 0.25) sentiment = "positive";
    else if (sentimentScore <= -0.25) sentiment = "negative";

    const top = items[0];
    const shortTermImpact =
      top.possibleMarketImpact ??
      (sentiment === "positive"
        ? "Mildly supportive near-term narrative if price action agrees."
        : sentiment === "negative"
          ? "Mildly cautious near-term narrative; wait for confirmation."
          : "Limited directional implication from headlines alone.");

    const riskWarning =
      highestImportance === "high"
        ? "High-importance headlines can move prices quickly — treat as decision support only."
        : "News is incomplete and may be stale or biased.";

    return {
      sentiment,
      importance: highestImportance,
      shortTermImpact,
      riskWarning,
      explanation: `Heuristic news lean ${sentiment} (score ${sentimentScore.toFixed(2)}, ${items.length} item${items.length === 1 ? "" : "s"}). Top: "${top.headline}" (${top.source}). Impact: ${shortTermImpact}`,
      sentimentScore: Number(sentimentScore.toFixed(3)),
    };
  }
}

/** Build heuristic interpretation from full NewsItem list. */
export async function heuristicFromItems(
  symbol: string,
  items: NewsItem[],
): Promise<AiNewsInterpretation> {
  const provider = new HeuristicNewsAiProvider();
  return provider.interpretSymbolNews({
    symbol,
    headlines: items.map((i) => ({
      headline: i.headline,
      source: i.source,
      summary: i.summary,
      sentiment: i.sentiment,
      importance: i.importance,
      possibleMarketImpact: i.possibleMarketImpact,
    })),
  });
}
