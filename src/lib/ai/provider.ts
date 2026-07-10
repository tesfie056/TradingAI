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

  return {
    baseUrl: (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").trim(),
    model: (process.env.OLLAMA_MODEL ?? "llama3.1").trim(),
    timeoutMs,
  };
}

function createPrimaryProvider(name: AiProviderName): NewsAiProvider {
  if (name === "ollama") {
    const { baseUrl, model, timeoutMs } = getOllamaConfig();
    return new OllamaNewsAiProvider({ baseUrl, model, timeoutMs });
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

export async function interpretWatchlistNews(input: {
  symbols: string[];
  itemsBySymbol: Record<string, NewsItem[]>;
}): Promise<{
  bySymbol: Record<string, AiNewsInterpretation>;
  status: AiProviderStatus;
}> {
  const bySymbol: Record<string, AiNewsInterpretation> = {};
  let status: AiProviderStatus = {
    requestedProvider: getAiProviderName(),
    activeProvider: getAiProviderName(),
    usedFallback: false,
    fallbackReason: null,
    model: getAiProviderName() === "ollama" ? getOllamaConfig().model : null,
    ok: true,
  };

  for (const symbol of input.symbols) {
    const result = await interpretSymbolNewsWithFallback({
      symbol,
      items: input.itemsBySymbol[symbol] ?? [],
    });
    bySymbol[symbol] = result.interpretation;
    // Prefer reporting fallback if any symbol fell back.
    if (result.status.usedFallback) {
      status = result.status;
    } else if (!status.usedFallback) {
      status = result.status;
    }
  }

  return { bySymbol, status };
}
