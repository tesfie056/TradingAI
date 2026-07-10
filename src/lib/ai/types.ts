import type { NewsImportance, NewsSentiment } from "@/lib/news/types";

export type AiProviderName = "heuristic" | "ollama";

export type AiNewsInterpretation = {
  sentiment: NewsSentiment;
  importance: NewsImportance;
  shortTermImpact: string;
  riskWarning: string;
  explanation: string;
  /** -1..1 derived from sentiment for confidence nudges */
  sentimentScore: number;
};

export type AiProviderStatus = {
  requestedProvider: AiProviderName;
  activeProvider: AiProviderName;
  usedFallback: boolean;
  fallbackReason: string | null;
  model: string | null;
  ok: boolean;
};

export interface NewsAiProvider {
  readonly name: AiProviderName;
  interpretSymbolNews(input: {
    symbol: string;
    headlines: Array<{
      headline: string;
      source: string;
      summary: string;
    }>;
  }): Promise<AiNewsInterpretation>;
}
