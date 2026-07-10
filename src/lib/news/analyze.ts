import { interpretWatchlistNews } from "@/lib/ai/provider";
import type { AiProviderStatus } from "@/lib/ai/types";
import type {
  NewsImportance,
  NewsItem,
  NewsSentiment,
  SymbolNewsAnalysis,
} from "@/lib/news/types";

const IMPORTANCE_WEIGHT: Record<NewsImportance, number> = {
  low: 0.35,
  medium: 0.7,
  high: 1,
};

function importanceRank(i: NewsImportance): number {
  return IMPORTANCE_WEIGHT[i];
}

function groupItems(
  symbols: string[],
  items: NewsItem[],
): Record<string, NewsItem[]> {
  const map: Record<string, NewsItem[]> = {};
  for (const symbol of symbols) {
    map[symbol] = [];
  }
  for (const item of items) {
    const symbol = item.symbol.toUpperCase();
    if (!map[symbol]) map[symbol] = [];
    map[symbol].push(item);
  }
  for (const symbol of Object.keys(map)) {
    map[symbol].sort(
      (a, b) =>
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
        importanceRank(b.importance) - importanceRank(a.importance),
    );
    map[symbol] = map[symbol].slice(0, 5);
  }
  return map;
}

/**
 * Aggregate + optionally enrich with Ollama/heuristic AI interpretation.
 * mode "heuristic" = fast (SSR). mode "auto" = Ollama with short timeout + cache.
 */
export async function analyzeWatchlistNews(
  symbols: string[],
  items: NewsItem[],
  opts?: { mode?: "auto" | "heuristic" },
): Promise<{
  bySymbol: Record<string, SymbolNewsAnalysis>;
  aiStatus: AiProviderStatus;
}> {
  const grouped = groupItems(symbols, items);
  const { bySymbol: aiBySymbol, status: aiStatus } =
    await interpretWatchlistNews({
      symbols,
      itemsBySymbol: grouped,
      mode: opts?.mode ?? "auto",
    });

  const bySymbol: Record<string, SymbolNewsAnalysis> = {};

  for (const symbol of symbols) {
    const relevant = grouped[symbol] ?? [];
    const ai = aiBySymbol[symbol];

    if (relevant.length === 0) {
      bySymbol[symbol] = {
        symbol: symbol.toUpperCase(),
        items: [],
        overallSentiment: null,
        highestImportance: null,
        sentimentScore: 0,
        explanation:
          ai?.explanation ??
          "No recent news items for this symbol — decisions rely on market data only.",
        shortTermImpact: ai?.shortTermImpact,
        riskWarning: ai?.riskWarning,
        aiProvider: aiStatus.activeProvider,
        paperOnly: true,
      };
      continue;
    }

    bySymbol[symbol] = {
      symbol: symbol.toUpperCase(),
      items: relevant,
      overallSentiment: ai?.sentiment ?? "neutral",
      highestImportance: ai?.importance ?? "low",
      sentimentScore: ai?.sentimentScore ?? 0,
      explanation: ai?.explanation ?? "News analysis unavailable.",
      shortTermImpact: ai?.shortTermImpact,
      riskWarning: ai?.riskWarning,
      aiProvider: aiStatus.activeProvider,
      paperOnly: true,
    };
  }

  return { bySymbol, aiStatus };
}

/** Sync heuristic-only helper for unit tests / simple callers. */
export function analyzeSymbolNews(
  symbol: string,
  items: NewsItem[],
): SymbolNewsAnalysis {
  const relevant = items
    .filter((i) => i.symbol.toUpperCase() === symbol.toUpperCase())
    .sort(
      (a, b) =>
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
        importanceRank(b.importance) - importanceRank(a.importance),
    )
    .slice(0, 5);

  if (relevant.length === 0) {
    return {
      symbol: symbol.toUpperCase(),
      items: [],
      overallSentiment: null,
      highestImportance: null,
      sentimentScore: 0,
      explanation:
        "No recent news items for this symbol — decisions rely on market data only.",
      aiProvider: "heuristic",
      paperOnly: true,
    };
  }

  const SENTIMENT_VALUE: Record<NewsSentiment, number> = {
    positive: 1,
    neutral: 0,
    negative: -1,
  };

  let weighted = 0;
  let weightSum = 0;
  let highestImportance: NewsImportance = "low";
  for (const item of relevant) {
    const w = IMPORTANCE_WEIGHT[item.importance];
    weighted += SENTIMENT_VALUE[item.sentiment] * w;
    weightSum += w;
    if (importanceRank(item.importance) > importanceRank(highestImportance)) {
      highestImportance = item.importance;
    }
  }
  const sentimentScore =
    weightSum > 0 ? Math.max(-1, Math.min(1, weighted / weightSum)) : 0;
  let overallSentiment: NewsSentiment = "neutral";
  if (sentimentScore >= 0.25) overallSentiment = "positive";
  else if (sentimentScore <= -0.25) overallSentiment = "negative";
  const top = relevant[0];

  return {
    symbol: symbol.toUpperCase(),
    items: relevant,
    overallSentiment,
    highestImportance,
    sentimentScore: Number(sentimentScore.toFixed(3)),
    explanation: `News lean ${overallSentiment} (score ${sentimentScore.toFixed(2)}, ${relevant.length} item${relevant.length === 1 ? "" : "s"}). Top: "${top.headline}" (${top.source}, ${top.importance}). Impact: ${top.possibleMarketImpact}`,
    shortTermImpact: top.possibleMarketImpact,
    riskWarning: "Heuristic-only analysis.",
    aiProvider: "heuristic",
    paperOnly: true,
  };
}

/**
 * Confidence nudge from news. Does not change action under safety HOLDs.
 */
export function newsConfidenceDelta(analysis: SymbolNewsAnalysis | undefined): {
  delta: number;
  note: string | null;
} {
  if (!analysis || analysis.items.length === 0) {
    return { delta: 0, note: null };
  }

  const mag = Math.abs(analysis.sentimentScore);
  const importanceBoost =
    analysis.highestImportance === "high"
      ? 1
      : analysis.highestImportance === "medium"
        ? 0.75
        : 0.5;
  const delta = Number(
    (analysis.sentimentScore * 0.12 * importanceBoost).toFixed(3),
  );

  if (mag < 0.1) {
    return {
      delta: 0,
      note: "News sentiment near neutral — no confidence adjustment.",
    };
  }

  const direction = delta > 0 ? "boosted" : "reduced";
  const via = analysis.aiProvider ?? "heuristic";
  return {
    delta,
    note: `News (${via}) ${direction} confidence by ${Math.abs(delta).toFixed(2)} (${analysis.overallSentiment}, ${analysis.highestImportance} importance). Decision support only — does not override safety HOLD.`,
  };
}
