/**
 * Phase 3.5 verification:
 * - NEWS_PROVIDER=mock works
 * - NEWS_PROVIDER=finnhub without key falls back safely
 * - news errors do not break AI decisions
 * - market closed still forces HOLD
 * - order execution remains OFF
 *
 * Run: npm run verify:phase3.5
 */
import assert from "node:assert/strict";
import { placePaperOrder } from "../src/lib/alpaca/client";
import { decideForSymbol } from "../src/lib/ai/decision";
import { isPaperOrderExecutionEnabled } from "../src/lib/config";
import { assessDataQuality } from "../src/lib/market/data-quality";
import { analyzeSymbolNews } from "../src/lib/news/analyze";
import {
  createNewsProvider,
  fetchWatchlistNews,
  getNewsProviderName,
} from "../src/lib/news";
import { scoreHeadlineSentiment } from "../src/lib/news/sentiment";
import type { AlpacaBar, SymbolMarketSnapshot } from "../src/lib/alpaca/types";

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

async function main() {
  // Sentiment helper
  const pos = scoreHeadlineSentiment(
    "Company beats estimates and raises guidance",
    "Strong growth outlook",
  );
  assert.equal(pos.sentiment, "positive");
  const neg = scoreHeadlineSentiment(
    "Shares plunge after earnings miss",
    "Weak demand warning",
  );
  assert.equal(neg.sentiment, "negative");

  // mock works
  process.env.NEWS_PROVIDER = "mock";
  delete process.env.FINNHUB_API_KEY;
  assert.equal(getNewsProviderName(), "mock");
  const mockCreated = createNewsProvider("mock");
  assert.equal(mockCreated.provider.name, "mock");
  const mockFetch = await fetchWatchlistNews(["AAPL", "MSFT"]);
  assert.equal(mockFetch.provider, "mock");
  assert.equal(mockFetch.status.usedFallback, false);
  assert.ok(mockFetch.items.length > 0);

  // finnhub without key falls back
  process.env.NEWS_PROVIDER = "finnhub";
  delete process.env.FINNHUB_API_KEY;
  assert.equal(getNewsProviderName(), "finnhub");
  const noKey = createNewsProvider("finnhub");
  assert.equal(noKey.provider.name, "mock");
  assert.equal(noKey.statusHint.usedFallback, true);
  assert.ok(noKey.statusHint.fallbackReason?.includes("FINNHUB_API_KEY"));

  const fallbackFetch = await fetchWatchlistNews(["AAPL"]);
  assert.equal(fallbackFetch.provider, "mock");
  assert.equal(fallbackFetch.status.usedFallback, true);
  assert.equal(fallbackFetch.status.requestedProvider, "finnhub");
  assert.ok(fallbackFetch.items.length > 0);

  // news errors do not break decisions
  const empty = analyzeSymbolNews("AAPL", []);
  const closed = decideForSymbol(closedSnapshot(), empty);
  assert.equal(closed.action, "HOLD");
  assert.ok(closed.reasons.some((r) => /market is closed/i.test(r)));

  // with news still HOLD when closed
  const withNews = decideForSymbol(
    closedSnapshot(),
    analyzeSymbolNews("AAPL", fallbackFetch.items),
  );
  assert.equal(withNews.action, "HOLD");
  assert.ok(withNews.newsContext);

  // order execution off
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  assert.equal(isPaperOrderExecutionEnabled(), false);
  await assert.rejects(
    () => placePaperOrder({ symbol: "AAPL", qty: 1, side: "buy" }),
    /disabled/i,
  );

  // restore default for other scripts in same process (best effort)
  process.env.NEWS_PROVIDER = "mock";

  console.log("verify-phase3.5: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
