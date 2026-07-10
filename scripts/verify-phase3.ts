/**
 * Phase 3 verification:
 * - news provider works (mock)
 * - missing news does not break decisions
 * - market closed still forces HOLD
 * - stale quote still forces HOLD
 * - order execution remains disabled
 *
 * Run: npm run verify:phase3
 */
import assert from "node:assert/strict";
import { placePaperOrder } from "../src/lib/alpaca/client";
import { decideForSymbol, generateWatchlistDecisions } from "../src/lib/ai/decision";
import { isPaperOrderExecutionEnabled } from "../src/lib/config";
import { assessDataQuality } from "../src/lib/market/data-quality";
import { analyzeSymbolNews, analyzeWatchlistNews } from "../src/lib/news/analyze";
import { createNewsProvider, fetchWatchlistNews } from "../src/lib/news";
import { MockNewsProvider } from "../src/lib/news/mock-provider";
import type { AlpacaBar, SymbolMarketSnapshot } from "../src/lib/alpaca/types";

function sampleBars(): AlpacaBar[] {
  const now = Date.now();
  return Array.from({ length: 8 }, (_, i) => {
    const c = 100 + i * 0.3;
    return {
      t: new Date(now - (8 - i) * 5 * 60_000).toISOString(),
      o: c - 0.1,
      h: c + 0.2,
      l: c - 0.2,
      c,
      v: 1000 + i * 10,
    };
  });
}

function makeSnapshot(opts: {
  isMarketOpen: boolean;
  quoteAgeMs: number;
  spreadPct?: number;
}): SymbolMarketSnapshot {
  const now = Date.now();
  const spreadPct = opts.spreadPct ?? 0.0005;
  const mid = 100;
  const half = (spreadPct * mid) / 2;
  const quoteTs = new Date(now - opts.quoteAgeMs).toISOString();
  const bars = sampleBars();
  const quote = {
    symbol: "AAPL",
    bid: mid - half,
    ask: mid + half,
    bidSize: 1,
    askSize: 1,
    timestamp: quoteTs,
  };
  const dataQuality = assessDataQuality({
    isMarketOpen: opts.isMarketOpen,
    quote,
    bars,
    nowMs: now,
  });
  return {
    symbol: "AAPL",
    bid: quote.bid,
    ask: quote.ask,
    mid,
    last: 100.2,
    spreadPct: dataQuality.spreadPercent,
    bars,
    timeframe: "5Min",
    quoteTimestamp: quoteTs,
    dataQuality,
  };
}

async function main() {
  // News provider works
  const mock = new MockNewsProvider();
  const items = await mock.getNewsForSymbols(["AAPL", "NVDA", "ZZZZ"]);
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.symbol === "AAPL" || i.symbol === "NVDA"));
  assert.equal(createNewsProvider("mock").provider.name, "mock");
  assert.equal(createNewsProvider("none").provider.name, "none");

  const fetched = await fetchWatchlistNews(["AAPL"]);
  assert.ok(fetched.provider === "mock" || fetched.provider === "none");
  assert.ok(fetched.status);

  const analysis = analyzeSymbolNews("AAPL", items);
  assert.equal(analysis.paperOnly, true);
  assert.ok(analysis.items.length > 0);
  assert.ok(["positive", "negative", "neutral", null].includes(analysis.overallSentiment as string | null));

  // Missing news does not break decisions
  const empty = analyzeSymbolNews("TSLA", []);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.sentimentScore, 0);
  const openFresh = makeSnapshot({ isMarketOpen: true, quoteAgeMs: 20_000 });
  const withEmptyNews = decideForSymbol(openFresh, empty);
  assert.ok(["BUY", "SELL", "HOLD"].includes(withEmptyNews.action));
  assert.equal(withEmptyNews.paperOnly, true);
  assert.ok(withEmptyNews.newsContext);

  // Closed market still HOLD even with bullish news
  const newsResult = await analyzeWatchlistNews(
    ["AAPL"],
    await mock.getNewsForSymbols(["AAPL"]),
  );
  const newsBySymbol = newsResult.bySymbol;
  const closed = decideForSymbol(
    makeSnapshot({ isMarketOpen: false, quoteAgeMs: 20_000 }),
    newsBySymbol.AAPL,
  );
  assert.equal(closed.action, "HOLD");
  assert.ok(closed.reasons.some((r) => /market is closed/i.test(r)));
  assert.ok(closed.newsContext);

  // Stale quote still HOLD
  const stale = decideForSymbol(
    makeSnapshot({ isMarketOpen: true, quoteAgeMs: 20 * 60_000 }),
    newsBySymbol.AAPL,
  );
  assert.equal(stale.action, "HOLD");
  assert.ok(stale.reasons.some((r) => /stale/i.test(r)));

  // Watchlist generation with news
  const decisions = generateWatchlistDecisions({
    symbols: ["AAPL"],
    quotes: [
      {
        symbol: "AAPL",
        bid: 100,
        ask: 100.05,
        bidSize: 1,
        askSize: 1,
        timestamp: new Date().toISOString(),
      },
    ],
    barsBySymbol: { AAPL: sampleBars() },
    isMarketOpen: false,
    newsBySymbol,
  });
  assert.equal(decisions[0].action, "HOLD");
  assert.ok(decisions[0].newsContext?.explanation);

  // Order execution disabled
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  assert.equal(isPaperOrderExecutionEnabled(), false);
  await assert.rejects(
    () => placePaperOrder({ symbol: "AAPL", qty: 1, side: "buy" }),
    /disabled/i,
  );

  console.log("verify-phase3: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
