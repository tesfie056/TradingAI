export type NewsSentiment = "positive" | "negative" | "neutral";
export type NewsImportance = "low" | "medium" | "high";

export type NewsItem = {
  id: string;
  symbol: string;
  headline: string;
  source: string;
  publishedAt: string;
  sentiment: NewsSentiment;
  importance: NewsImportance;
  summary: string;
  possibleMarketImpact: string;
  url?: string;
};

export type SymbolNewsAnalysis = {
  symbol: string;
  items: NewsItem[];
  /** Aggregate lean from recent items; null if no news. */
  overallSentiment: NewsSentiment | null;
  highestImportance: NewsImportance | null;
  /** -1..1 score used to nudge confidence (not action under safety holds). */
  sentimentScore: number;
  explanation: string;
  shortTermImpact?: string;
  riskWarning?: string;
  aiProvider?: "heuristic" | "ollama";
  paperOnly: true;
};

export interface NewsProvider {
  readonly name: string;
  getNewsForSymbols(symbols: string[]): Promise<NewsItem[]>;
}
