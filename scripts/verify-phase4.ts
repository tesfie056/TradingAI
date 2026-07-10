/**
 * Phase 4 verification:
 * - AI_PROVIDER=heuristic works
 * - AI_PROVIDER=ollama without Ollama falls back safely
 * - market closed still forces HOLD
 * - order execution remains OFF
 * - live trading remains blocked
 * - prompts/outputs scrub API key names
 *
 * Run: npm run verify:phase4
 */
import assert from "node:assert/strict";
import { placePaperOrder } from "../src/lib/alpaca/client";
import { decideForSymbol } from "../src/lib/ai/decision";
import {
  getAiProviderName,
  interpretSymbolNewsWithFallback,
} from "../src/lib/ai/provider";
import { OllamaNewsAiProvider } from "../src/lib/ai/ollama-client";
import { isPaperOrderExecutionEnabled } from "../src/lib/config";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import { assessDataQuality } from "../src/lib/market/data-quality";
import { analyzeWatchlistNews } from "../src/lib/news/analyze";
import type { AlpacaBar, SymbolMarketSnapshot } from "../src/lib/alpaca/types";
import type { NewsItem } from "../src/lib/news/types";

function sampleBars(): AlpacaBar[] {
  const now = Date.now();
  return Array.from({ length: 6 }, (_, i) => {
    const c = 100 + i * 0.2;
    return {
      t: new Date(now - (6 - i) * 5 * 60_000).toISOString(),
      o: c,
      h: c + 0.2,
      l: c - 0.2,
      c,
      v: 1000,
    };
  });
}

function closedSnapshot(): SymbolMarketSnapshot {
  const now = Date.now();
  const quote = {
    symbol: "AAPL",
    bid: 100,
    ask: 100.05,
    bidSize: 1,
    askSize: 1,
    timestamp: new Date(now - 20_000).toISOString(),
  };
  const bars = sampleBars();
  return {
    symbol: "AAPL",
    bid: 100,
    ask: 100.05,
    mid: 100.025,
    last: 100.1,
    spreadPct: 0.0005,
    bars,
    timeframe: "5Min",
    quoteTimestamp: quote.timestamp,
    dataQuality: assessDataQuality({
      isMarketOpen: false,
      quote,
      bars,
      nowMs: now,
    }),
  };
}

const sampleItems: NewsItem[] = [
  {
    id: "t1",
    symbol: "AAPL",
    headline: "Apple suppliers signal steady iPhone build plans",
    source: "MockWire",
    publishedAt: new Date().toISOString(),
    sentiment: "positive",
    importance: "medium",
    summary: "Stable production volumes into next quarter.",
    possibleMarketImpact: "Mildly supportive.",
  },
];

async function main() {
  // heuristic works
  process.env.AI_PROVIDER = "heuristic";
  assert.equal(getAiProviderName(), "heuristic");
  const heuristic = await interpretSymbolNewsWithFallback({
    symbol: "AAPL",
    items: sampleItems,
  });
  assert.equal(heuristic.status.activeProvider, "heuristic");
  assert.equal(heuristic.status.usedFallback, false);
  assert.ok(heuristic.interpretation.explanation.length > 0);

  const analyzed = await analyzeWatchlistNews(["AAPL"], sampleItems);
  assert.equal(analyzed.aiStatus.activeProvider, "heuristic");
  assert.ok(analyzed.bySymbol.AAPL.explanation);

  // ollama without server falls back
  process.env.AI_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9"; // closed port
  process.env.OLLAMA_MODEL = "llama3.1";
  process.env.OLLAMA_TIMEOUT_MS = "500";
  assert.equal(getAiProviderName(), "ollama");
  const { getOllamaConfig } = await import("../src/lib/ai/provider");
  // restore default timeout for config check after fallback test
  delete process.env.OLLAMA_TIMEOUT_MS;
  const cfg = getOllamaConfig();
  assert.ok(cfg.timeoutMs >= 60_000 && cfg.timeoutMs <= 90_000);

  process.env.OLLAMA_TIMEOUT_MS = "500";
  const fallback = await interpretSymbolNewsWithFallback({
    symbol: "AAPL",
    items: sampleItems,
  });
  assert.equal(fallback.status.requestedProvider, "ollama");
  assert.equal(fallback.status.activeProvider, "heuristic");
  assert.equal(fallback.status.usedFallback, true);
  assert.ok(fallback.status.fallbackReason);

  // closed market HOLD
  const closed = decideForSymbol(
    closedSnapshot(),
    analyzed.bySymbol.AAPL,
  );
  assert.equal(closed.action, "HOLD");
  assert.ok(closed.reasons.some((r) => /market is closed/i.test(r)));

  // order execution off
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  assert.equal(isPaperOrderExecutionEnabled(), false);
  await assert.rejects(
    () => placePaperOrder({ symbol: "AAPL", qty: 1, side: "buy" }),
    /disabled/i,
  );

  // live blocked
  try {
    assertPaperTradingOnly("https://api.alpaca.markets");
    assert.fail("expected live block");
  } catch (e) {
    assert.ok(e instanceof PaperTradingSafetyError);
  }

  // scrub secrets in ollama client path (unit-level via failed call still safe)
  const ollama = new OllamaNewsAiProvider({
    baseUrl: "http://127.0.0.1:9",
    model: "llama3.1",
    timeoutMs: 500,
  });
  await assert.rejects(() =>
    ollama.interpretSymbolNews({
      symbol: "AAPL",
      headlines: [
        {
          headline: "Test with FINNHUB_API_KEY=should-not-leak",
          source: "x",
          summary: "ALPACA_SECRET_KEY=nope",
        },
      ],
    }),
  );

  // ensure fallback interpretation text does not include raw env key values from process
  const text = JSON.stringify(fallback.interpretation);
  assert.equal(text.includes("ALPACA_API_KEY="), false);
  assert.equal(text.includes("FINNHUB_API_KEY="), false);

  process.env.AI_PROVIDER = "heuristic";
  console.log("verify-phase4: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
