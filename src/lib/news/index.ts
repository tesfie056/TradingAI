import { EmptyNewsProvider } from "@/lib/news/empty-provider";
import { FinnhubNewsProvider } from "@/lib/news/finnhub-provider";
import { MockNewsProvider } from "@/lib/news/mock-provider";
import type { NewsItem, NewsProvider } from "@/lib/news/types";

export type NewsProviderName = "mock" | "finnhub" | "none";

export type NewsFetchStatus = {
  requestedProvider: NewsProviderName;
  activeProvider: string;
  usedFallback: boolean;
  fallbackReason: string | null;
  ok: boolean;
};

export type WatchlistNewsResult = {
  provider: string;
  items: NewsItem[];
  status: NewsFetchStatus;
};

export function getNewsProviderName(): NewsProviderName {
  const raw = (process.env.NEWS_PROVIDER ?? "mock").trim().toLowerCase();
  if (raw === "finnhub") return "finnhub";
  if (raw === "none") return "none";
  return "mock";
}

export function getFinnhubApiKey(): string | null {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) return null;
  return key;
}

export function createNewsProvider(
  name: NewsProviderName = getNewsProviderName(),
): { provider: NewsProvider; statusHint: Partial<NewsFetchStatus> } {
  if (name === "none") {
    return {
      provider: new EmptyNewsProvider(),
      statusHint: {
        requestedProvider: "none",
        activeProvider: "none",
        usedFallback: false,
        fallbackReason: null,
        ok: true,
      },
    };
  }

  if (name === "finnhub") {
    const key = getFinnhubApiKey();
    if (!key) {
      return {
        provider: new MockNewsProvider(),
        statusHint: {
          requestedProvider: "finnhub",
          activeProvider: "mock",
          usedFallback: true,
          fallbackReason:
            "FINNHUB_API_KEY missing — using mock news provider.",
          ok: true,
        },
      };
    }
    return {
      provider: new FinnhubNewsProvider(key),
      statusHint: {
        requestedProvider: "finnhub",
        activeProvider: "finnhub",
        usedFallback: false,
        fallbackReason: null,
        ok: true,
      },
    };
  }

  return {
    provider: new MockNewsProvider(),
    statusHint: {
      requestedProvider: "mock",
      activeProvider: "mock",
      usedFallback: false,
      fallbackReason: null,
      ok: true,
    },
  };
}

/**
 * Fetch watchlist news with safe fallback to mock.
 * Never throws; never logs API keys.
 */
export async function fetchWatchlistNews(
  symbols: string[],
): Promise<WatchlistNewsResult> {
  const requested = getNewsProviderName();
  const { provider, statusHint } = createNewsProvider(requested);

  try {
    const items = await provider.getNewsForSymbols(symbols);
    return {
      provider: provider.name,
      items,
      status: {
        requestedProvider: requested,
        activeProvider: provider.name,
        usedFallback: Boolean(statusHint.usedFallback),
        fallbackReason: statusHint.fallbackReason ?? null,
        ok: true,
      },
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? `Finnhub/provider error — falling back to mock (${error.message}).`
        : "News provider error — falling back to mock.";

    // If we were already on mock/none, return empty rather than looping.
    if (provider.name === "mock" || provider.name === "none") {
      return {
        provider: provider.name,
        items: [],
        status: {
          requestedProvider: requested,
          activeProvider: provider.name,
          usedFallback: true,
          fallbackReason: reason,
          ok: false,
        },
      };
    }

    try {
      const mock = new MockNewsProvider();
      const items = await mock.getNewsForSymbols(symbols);
      return {
        provider: mock.name,
        items,
        status: {
          requestedProvider: requested,
          activeProvider: "mock",
          usedFallback: true,
          fallbackReason: reason,
          ok: true,
        },
      };
    } catch {
      return {
        provider: "mock",
        items: [],
        status: {
          requestedProvider: requested,
          activeProvider: "mock",
          usedFallback: true,
          fallbackReason: reason,
          ok: false,
        },
      };
    }
  }
}
