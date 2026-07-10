import { impactFromSentiment, scoreHeadlineSentiment } from "@/lib/news/sentiment";
import type { NewsItem, NewsProvider } from "@/lib/news/types";

type FinnhubCompanyNews = {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lookbackRange(days = 7): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: ymd(from), to: ymd(to) };
}

/**
 * Finnhub company-news provider.
 * Never logs the API key. Throws on HTTP/rate-limit errors so the factory can fall back.
 */
export class FinnhubNewsProvider implements NewsProvider {
  readonly name = "finnhub";
  private readonly apiKey: string;
  private readonly lookbackDays: number;

  constructor(apiKey: string, lookbackDays = 7) {
    this.apiKey = apiKey;
    this.lookbackDays = lookbackDays;
  }

  async getNewsForSymbols(symbols: string[]): Promise<NewsItem[]> {
    const { from, to } = lookbackRange(this.lookbackDays);
    const all: NewsItem[] = [];

    // Sequential to reduce free-tier rate-limit pressure.
    for (const symbol of symbols) {
      const items = await this.fetchSymbol(symbol.toUpperCase(), from, to);
      all.push(...items);
    }

    return all;
  }

  private async fetchSymbol(
    symbol: string,
    from: string,
    to: string,
  ): Promise<NewsItem[]> {
    const params = new URLSearchParams({
      symbol,
      from,
      to,
      token: this.apiKey,
    });
    const url = `https://finnhub.io/api/v1/company-news?${params}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (res.status === 429) {
      throw new Error("Finnhub rate limited (429)");
    }
    if (!res.ok) {
      // Do not include response body if it might echo the token.
      throw new Error(`Finnhub company-news failed (${res.status})`);
    }

    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new Error("Finnhub company-news returned unexpected payload");
    }

    return (data as FinnhubCompanyNews[])
      .filter((row) => row.headline && row.headline.trim().length > 0)
      .slice(0, 5)
      .map((row, index) => {
        const headline = row.headline!.trim();
        const summary = (row.summary ?? headline).trim();
        const { sentiment, importance } = scoreHeadlineSentiment(
          headline,
          summary,
        );
        const publishedAt =
          typeof row.datetime === "number" && row.datetime > 0
            ? new Date(row.datetime * 1000).toISOString()
            : new Date().toISOString();

        return {
          id: `finnhub-${symbol}-${row.id ?? index}`,
          symbol,
          headline,
          source: row.source?.trim() || "Finnhub",
          publishedAt,
          sentiment,
          importance,
          summary,
          possibleMarketImpact: impactFromSentiment(sentiment, importance),
          url: row.url?.trim() || undefined,
        } satisfies NewsItem;
      });
  }
}
