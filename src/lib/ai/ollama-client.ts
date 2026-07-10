import type {
  AiNewsInterpretation,
  NewsAiProvider,
} from "@/lib/ai/types";
import type { NewsImportance, NewsSentiment } from "@/lib/news/types";

type OllamaGenerateResponse = {
  response?: string;
};

const SECRET_PATTERNS = [
  /FINNHUB_API_KEY/gi,
  /ALPACA_API_KEY/gi,
  /ALPACA_SECRET_KEY/gi,
  /APCA-API/gi,
  /token=[^\s&"']+/gi,
];

function scrubSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[redacted]");
  }
  return out;
}

function parseSentiment(raw: unknown): NewsSentiment {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "positive" || s === "negative" || s === "neutral") return s;
  return "neutral";
}

function parseImportance(raw: unknown): NewsImportance {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return "medium";
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : cleaned;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function scoreFromSentiment(sentiment: NewsSentiment): number {
  if (sentiment === "positive") return 0.65;
  if (sentiment === "negative") return -0.65;
  return 0;
}

/**
 * Local Ollama news interpreter. Server-side only. Never sends API keys.
 */
export class OllamaNewsAiProvider implements NewsAiProvider {
  readonly name = "ollama" as const;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts: {
    baseUrl: string;
    model: string;
    timeoutMs?: number;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.model = opts.model;
    // Local models often need 60–90s; default 75s unless overridden.
    this.timeoutMs = opts.timeoutMs ?? 75_000;
  }

  async interpretSymbolNews(input: {
    symbol: string;
    headlines: Array<{
      headline: string;
      source: string;
      summary: string;
    }>;
  }): Promise<AiNewsInterpretation> {
    if (input.headlines.length === 0) {
      return {
        sentiment: "neutral",
        importance: "low",
        shortTermImpact: "No headlines to interpret.",
        riskWarning: "Insufficient news context.",
        explanation: "No recent news for Ollama to analyze.",
        sentimentScore: 0,
      };
    }

    // Keep prompts short for reliability on local models.
    const bulletList = input.headlines
      .slice(0, 3)
      .map(
        (h, i) =>
          `${i + 1}. [${scrubSecrets(h.source)}] ${scrubSecrets(h.headline)} — ${scrubSecrets(h.summary).slice(0, 160)}`,
      )
      .join("\n");

    const prompt = `You are a cautious paper-trading research assistant. Analyze news for stock ${input.symbol.toUpperCase()} only.
Do not give financial advice. Do not invent facts. Do not mention API keys or credentials.
Return ONLY valid JSON with keys:
sentiment ("positive"|"negative"|"neutral"),
importance ("low"|"medium"|"high"),
shortTermImpact (one short sentence),
riskWarning (one short sentence),
explanation (2 short sentences in simple English).

Headlines:
${bulletList}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: "json",
          options: { temperature: 0.2, num_predict: 220 },
        }),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}`);
      }

      const data = (await res.json()) as OllamaGenerateResponse;
      const raw = scrubSecrets(data.response ?? "");
      const parsed = extractJsonObject(raw);
      if (!parsed) {
        throw new Error("Ollama returned non-JSON analysis");
      }

      const sentiment = parseSentiment(parsed.sentiment);
      const importance = parseImportance(parsed.importance);
      const shortTermImpact = scrubSecrets(
        String(parsed.shortTermImpact ?? parsed.short_term_impact ?? "").trim() ||
          "Unclear short-term impact from available headlines.",
      );
      const riskWarning = scrubSecrets(
        String(parsed.riskWarning ?? parsed.risk_warning ?? "").trim() ||
          "Local model output may be incomplete — treat as decision support only.",
      );
      const explanation = scrubSecrets(
        String(parsed.explanation ?? "").trim() ||
          `Ollama lean ${sentiment} for ${input.symbol}.`,
      );

      return {
        sentiment,
        importance,
        shortTermImpact,
        riskWarning,
        explanation,
        sentimentScore: scoreFromSentiment(sentiment),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Ollama request timed out after ${Math.round(this.timeoutMs / 1000)}s`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
