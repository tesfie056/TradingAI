import { HeuristicNewsAiProvider } from "@/lib/ai/heuristic-provider";
import { OllamaNewsAiProvider } from "@/lib/ai/ollama-client";
import type {
  AiNewsInterpretation,
  AiProviderName,
  AiProviderStatus,
  NewsAiProvider,
} from "@/lib/ai/types";
import type { NewsItem } from "@/lib/news/types";

export function getAiProviderName(): AiProviderName {
  const raw = (process.env.AI_PROVIDER ?? "heuristic").trim().toLowerCase();
  if (raw === "ollama") return "ollama";
  return "heuristic";
}

/** Default 75s — local llama3.1 JSON generation often exceeds short timeouts. */
export const DEFAULT_OLLAMA_TIMEOUT_MS = 75_000;

export function getOllamaConfig() {
  const rawTimeout = process.env.OLLAMA_TIMEOUT_MS?.trim();
  const parsed = rawTimeout ? Number(rawTimeout) : DEFAULT_OLLAMA_TIMEOUT_MS;
  const timeoutMs =
    Number.isFinite(parsed) && parsed >= 5_000
      ? Math.min(parsed, 180_000)
      : DEFAULT_OLLAMA_TIMEOUT_MS;

  // News enrichment should fail fast to heuristic — never block the UI for minutes.
  const rawNews = process.env.OLLAMA_NEWS_TIMEOUT_MS?.trim();
  const parsedNews = rawNews ? Number(rawNews) : 20_000;
  const newsTimeoutMs =
    Number.isFinite(parsedNews) && parsedNews >= 3_000
      ? Math.min(parsedNews, 60_000)
      : 20_000;

  return {
    baseUrl: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").trim(),
    model: (process.env.OLLAMA_MODEL ?? "llama3.1").trim(),
    timeoutMs,
    newsTimeoutMs,
  };
}

function createPrimaryProvider(
  name: AiProviderName,
  timeoutMs?: number,
): NewsAiProvider {
  if (name === "ollama") {
    const { baseUrl, model, newsTimeoutMs } = getOllamaConfig();
    return new OllamaNewsAiProvider({
      baseUrl,
      model,
      timeoutMs: timeoutMs ?? newsTimeoutMs,
    });
  }
  return new HeuristicNewsAiProvider();
}

export type OllamaHealthResult = {
  requestedProvider: AiProviderName;
  ollamaConfigured: boolean;
  connected: boolean;
  model: string | null;
  baseUrlHost: string | null;
  latencyMs: number | null;
  message: string;
  paperOnly: true;
};

/**
 * Lightweight Ollama reachability check (tags endpoint). No prompts, no secrets.
 */
export async function checkOllamaHealth(): Promise<OllamaHealthResult> {
  const requested = getAiProviderName();
  const { baseUrl, model } = getOllamaConfig();
  let baseUrlHost: string | null = null;
  try {
    baseUrlHost = new URL(baseUrl).host;
  } catch {
    baseUrlHost = null;
  }

  if (requested !== "ollama") {
    return {
      requestedProvider: requested,
      ollamaConfigured: false,
      connected: false,
      model: null,
      baseUrlHost,
      latencyMs: null,
      message: "AI_PROVIDER is not ollama — heuristic mode.",
      paperOnly: true,
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        requestedProvider: "ollama",
        ollamaConfigured: true,
        connected: false,
        model,
        baseUrlHost,
        latencyMs: Date.now() - started,
        message: `Ollama responded with HTTP ${res.status}.`,
        paperOnly: true,
      };
    }
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const names = (data.models ?? []).map((m) => m.name ?? "");
    const modelReady =
      names.some((n) => n === model || n.startsWith(`${model}:`)) ||
      names.length > 0;

    return {
      requestedProvider: "ollama",
      ollamaConfigured: true,
      connected: modelReady,
      model,
      baseUrlHost,
      latencyMs: Date.now() - started,
      message: modelReady
        ? `Ollama connected (${baseUrlHost ?? "local"}).`
        : `Ollama reachable but model "${model}" not listed.`,
      paperOnly: true,
    };
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "AbortError"
        ? "health check timed out"
        : error instanceof Error
          ? error.message
          : "unreachable";
    return {
      requestedProvider: "ollama",
      ollamaConfigured: true,
      connected: false,
      model,
      baseUrlHost,
      latencyMs: Date.now() - started,
      message: `Ollama unavailable (${detail}).`,
      paperOnly: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

export type SymbolAiResult = {
  interpretation: AiNewsInterpretation;
  status: AiProviderStatus;
};

/**
 * Interpret news for one symbol with Ollama optional + heuristic fallback.
 * Never throws; never includes API keys in prompts/outputs.
 */
export async function interpretSymbolNewsWithFallback(input: {
  symbol: string;
  items: NewsItem[];
}): Promise<SymbolAiResult> {
  const requested = getAiProviderName();
  const { model } = getOllamaConfig();
  const heuristic = new HeuristicNewsAiProvider();
  const headlines = input.items.map((i) => ({
    headline: i.headline,
    source: i.source,
    summary: i.summary,
    sentiment: i.sentiment,
    importance: i.importance,
    possibleMarketImpact: i.possibleMarketImpact,
  }));

  if (requested === "heuristic") {
    const interpretation = await heuristic.interpretSymbolNews({
      symbol: input.symbol,
      headlines,
    });
    return {
      interpretation,
      status: {
        requestedProvider: "heuristic",
        activeProvider: "heuristic",
        usedFallback: false,
        fallbackReason: null,
        model: null,
        ok: true,
      },
    };
  }

  const ollama = createPrimaryProvider("ollama");
  try {
    const interpretation = await ollama.interpretSymbolNews({
      symbol: input.symbol,
      headlines,
    });
    return {
      interpretation,
      status: {
        requestedProvider: "ollama",
        activeProvider: "ollama",
        usedFallback: false,
        fallbackReason: null,
        model,
        ok: true,
      },
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? `Ollama unavailable — using heuristic (${error.message}).`
        : "Ollama unavailable — using heuristic.";
    const interpretation = await heuristic.interpretSymbolNews({
      symbol: input.symbol,
      headlines,
    });
    return {
      interpretation,
      status: {
        requestedProvider: "ollama",
        activeProvider: "heuristic",
        usedFallback: true,
        fallbackReason: reason,
        model,
        ok: true,
      },
    };
  }
}

type NewsCacheEntry = {
  at: number;
  interpretation: AiNewsInterpretation;
  status: AiProviderStatus;
};

const NEWS_AI_CACHE = new Map<string, NewsCacheEntry>();
const NEWS_AI_CACHE_TTL_MS = 90_000;

function newsCacheKey(symbol: string, items: NewsItem[]): string {
  const heads = items
    .slice(0, 3)
    .map((i) => i.headline)
    .join("|");
  return `${symbol.toUpperCase()}::${heads}`;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export async function interpretWatchlistNews(input: {
  symbols: string[];
  itemsBySymbol: Record<string, NewsItem[]>;
  /** heuristic = skip Ollama (fast SSR). auto = Ollama with short timeout + cache. */
  mode?: "auto" | "heuristic";
}): Promise<{
  bySymbol: Record<string, AiNewsInterpretation>;
  status: AiProviderStatus;
}> {
  const mode = input.mode ?? "auto";
  const requested = getAiProviderName();
  const bySymbol: Record<string, AiNewsInterpretation> = {};
  let status: AiProviderStatus = {
    requestedProvider: requested,
    activeProvider: mode === "heuristic" ? "heuristic" : requested,
    usedFallback: false,
    fallbackReason:
      mode === "heuristic" && requested === "ollama"
        ? "Fast path used heuristic news; refresh to enrich with Ollama."
        : null,
    model: requested === "ollama" ? getOllamaConfig().model : null,
    ok: true,
  };

  const runOne = async (symbol: string) => {
    const items = input.itemsBySymbol[symbol] ?? [];
    if (mode === "heuristic" || requested === "heuristic") {
      const heuristic = new HeuristicNewsAiProvider();
      const interpretation = await heuristic.interpretSymbolNews({
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
      return {
        symbol,
        interpretation,
        status: {
          requestedProvider: requested,
          activeProvider: "heuristic" as const,
          usedFallback: requested === "ollama",
          fallbackReason:
            requested === "ollama"
              ? "Fast path used heuristic news; refresh to enrich with Ollama."
              : null,
          model: requested === "ollama" ? getOllamaConfig().model : null,
          ok: true,
        } satisfies AiProviderStatus,
      };
    }

    const key = newsCacheKey(symbol, items);
    const cached = NEWS_AI_CACHE.get(key);
    if (cached && Date.now() - cached.at < NEWS_AI_CACHE_TTL_MS) {
      return {
        symbol,
        interpretation: cached.interpretation,
        status: cached.status,
      };
    }

    const result = await interpretSymbolNewsWithFallback({ symbol, items });
    NEWS_AI_CACHE.set(key, {
      at: Date.now(),
      interpretation: result.interpretation,
      status: result.status,
    });
    return {
      symbol,
      interpretation: result.interpretation,
      status: result.status,
    };
  };

  // Cap concurrency — local Ollama usually serializes; 2 keeps wall-clock down
  // without stacking five 20s+ generations.
  const results = await mapPool(input.symbols, 2, runOne);

  for (const result of results) {
    bySymbol[result.symbol] = result.interpretation;
    if (result.status.usedFallback) {
      status = result.status;
    } else if (!status.usedFallback) {
      status = result.status;
    }
  }

  return { bySymbol, status };
}
