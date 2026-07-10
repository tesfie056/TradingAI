import type { NewsItem, NewsProvider } from "@/lib/news/types";

/**
 * Placeholder for a future real news API.
 * Returns empty results so missing/unconfigured news never breaks decisions.
 */
export class EmptyNewsProvider implements NewsProvider {
  readonly name = "none";

  async getNewsForSymbols(symbols: string[]): Promise<NewsItem[]> {
    void symbols;
    return [];
  }
}
