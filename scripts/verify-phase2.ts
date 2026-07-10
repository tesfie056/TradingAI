/**
 * Phase 2 verification:
 * - no live endpoint
 * - no order execution
 * - decision output shape
 * - watchlist parsing
 *
 * Run: npm run verify:phase2
 */
import assert from "node:assert/strict";
import {
  assertPaperTradingOnly,
  assertSafeTradingRequestUrl,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import { placePaperOrder } from "../src/lib/alpaca/client";
import { parseWatchlist, isPaperOrderExecutionEnabled } from "../src/lib/config";
import {
  decideForSymbol,
  generateWatchlistDecisions,
} from "../src/lib/ai/decision";
import type { AlpacaBar, SymbolMarketSnapshot } from "../src/lib/alpaca/types";

function expectSafetyThrow(fn: () => void, label: string) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = e instanceof PaperTradingSafetyError;
  }
  assert.equal(threw, true, `expected PaperTradingSafetyError for ${label}`);
}

function assertDecisionShape(d: {
  symbol: string;
  action: string;
  confidence: number;
  reasons: string[];
  riskWarnings: string[];
  timestamp: string;
  paperOnly: boolean;
}) {
  assert.equal(typeof d.symbol, "string");
  assert.ok(["BUY", "SELL", "HOLD"].includes(d.action), `bad action ${d.action}`);
  assert.equal(typeof d.confidence, "number");
  assert.ok(d.confidence >= 0 && d.confidence <= 1);
  assert.ok(Array.isArray(d.reasons));
  assert.ok(Array.isArray(d.riskWarnings));
  assert.equal(typeof d.timestamp, "string");
  assert.equal(d.paperOnly, true);
}

function sampleBars(trend: "up" | "down" | "flat"): AlpacaBar[] {
  const now = Date.now();
  const base = 100;
  return Array.from({ length: 12 }, (_, i) => {
    const drift =
      trend === "up" ? i * 0.4 : trend === "down" ? -i * 0.4 : (i % 2) * 0.05;
    const c = base + drift;
    return {
      t: new Date(now - (12 - i) * 5 * 60_000).toISOString(),
      o: c - 0.1,
      h: c + 0.5,
      l: c - 0.5,
      c,
      v: 1000 + i * 50,
    };
  });
}

async function main() {
  // Watchlist parsing
  assert.deepEqual(parseWatchlist("AAPL, MSFT, googl"), [
    "AAPL",
    "MSFT",
    "GOOGL",
  ]);
  assert.deepEqual(parseWatchlist("AAPL,AAPL,msft"), ["AAPL", "MSFT"]);
  assert.ok(parseWatchlist("").includes("AAPL"));
  assert.ok(parseWatchlist("!!!").includes("AAPL"));

  // Safety: reject live
  assertPaperTradingOnly("https://paper-api.alpaca.markets");
  expectSafetyThrow(
    () => assertPaperTradingOnly("https://api.alpaca.markets"),
    "live base",
  );
  expectSafetyThrow(
    () => assertSafeTradingRequestUrl("https://api.alpaca.markets/v2/orders"),
    "live request",
  );

  // Order execution off
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  assert.equal(isPaperOrderExecutionEnabled(), false);
  await assert.rejects(
    () => placePaperOrder({ symbol: "AAPL", qty: 1, side: "buy" }),
    /disabled/i,
  );

  // Decision shape — single
  const bars = sampleBars("up");
  const snap: SymbolMarketSnapshot = {
    symbol: "AAPL",
    bid: 190,
    ask: 190.05,
    mid: 190.025,
    last: 190.02,
    spreadPct: 0.05 / 190.025,
    bars,
    timeframe: "5Min",
    quoteTimestamp: new Date().toISOString(),
    dataQuality: {
      isMarketOpen: true,
      isQuoteStale: false,
      spreadPercent: 0.05 / 190.025,
      hasRecentBars: true,
      warningMessages: [],
    },
  };
  const one = decideForSymbol(snap);
  assertDecisionShape(one);

  // Decision for every watchlist symbol
  const symbols = ["AAPL", "MSFT", "GOOGL"];
  const decisions = generateWatchlistDecisions({
    symbols,
    quotes: symbols.map((symbol) => ({
      symbol,
      bid: 100,
      ask: 100.1,
      bidSize: 1,
      askSize: 1,
      timestamp: new Date().toISOString(),
    })),
    barsBySymbol: {
      AAPL: sampleBars("up"),
      MSFT: sampleBars("down"),
      GOOGL: sampleBars("flat"),
    },
    timeframe: "5Min",
    isMarketOpen: true,
  });

  assert.equal(decisions.length, symbols.length);
  for (const d of decisions) {
    assertDecisionShape(d);
    assert.ok(symbols.includes(d.symbol));
  }

  console.log("verify-phase2: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
