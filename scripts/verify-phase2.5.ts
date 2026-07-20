/**
 * Phase 2.5 verification:
 * - market clock normalize shape
 * - stale quote detection
 * - closed market forces HOLD
 * - wide spread forces HOLD
 * - order execution still disabled
 *
 * Run: npm run verify:phase2.5
 */
import assert from "node:assert/strict";
import { placePaperOrder } from "../src/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import { isPaperOrderExecutionEnabled } from "../src/lib/config";
import {
  decideForSymbol,
  generateWatchlistDecisions,
} from "../src/lib/ai/decision";
import type { AlpacaBar, SymbolMarketSnapshot } from "../src/lib/alpaca/types";
import {
  assessDataQuality,
  isQuoteStale,
  normalizeClock,
  WIDE_SPREAD_HOLD_PCT,
} from "../src/lib/market/data-quality";

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

function snapshotWithQuality(
  overrides: Partial<SymbolMarketSnapshot> & {
    isMarketOpen: boolean;
    quoteAgeMs?: number;
    spreadPct?: number | null;
  },
): SymbolMarketSnapshot {
  const now = Date.now();
  const quoteAgeMs = overrides.quoteAgeMs ?? 30_000;
  const quoteTs = new Date(now - quoteAgeMs).toISOString();
  const spreadPct = overrides.spreadPct ?? 0.0005;
  const mid = 100;
  const half = ((spreadPct ?? 0) * mid) / 2;
  const bars = overrides.bars ?? sampleBars();
  const quote = {
    symbol: "AAPL",
    bid: mid - half,
    ask: mid + half,
    bidSize: 1,
    askSize: 1,
    timestamp: quoteTs,
  };
  const dataQuality = assessDataQuality({
    isMarketOpen: overrides.isMarketOpen,
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
    ...overrides,
    dataQuality: overrides.dataQuality ?? dataQuality,
  };
}

async function main() {
  // Clock normalize
  const clock = normalizeClock({
    timestamp: "2026-07-10T15:00:00Z",
    is_open: false,
    next_open: "2026-07-10T13:30:00Z",
    next_close: "2026-07-10T20:00:00Z",
  });
  assert.equal(clock.isOpen, false);
  assert.equal(clock.paperOnly, true);
  assert.ok(clock.nextOpen);
  assert.ok(clock.nextClose);

  // Stale quote detection
  const now = Date.now();
  assert.equal(isQuoteStale(new Date(now - 60_000).toISOString(), true, now), false);
  assert.equal(
    isQuoteStale(new Date(now - 10 * 60_000).toISOString(), true, now),
    true,
  );
  assert.equal(
    isQuoteStale(new Date(now - 30_000).toISOString(), false, now),
    true,
    "closed market treats quotes as stale",
  );
  assert.equal(isQuoteStale(null, true, now), true);

  // Closed market forces HOLD
  const closed = decideForSymbol(
    snapshotWithQuality({ isMarketOpen: false, quoteAgeMs: 30_000 }),
  );
  assert.equal(closed.action, "HOLD");
  assert.ok(closed.reasons.some((r) => /market is closed/i.test(r)));
  assert.equal(closed.dataQuality?.isMarketOpen, false);

  // Stale quote while open forces HOLD
  const stale = decideForSymbol(
    snapshotWithQuality({ isMarketOpen: true, quoteAgeMs: 15 * 60_000 }),
  );
  assert.equal(stale.action, "HOLD");
  assert.ok(stale.reasons.some((r) => /stale/i.test(r)));
  assert.equal(stale.dataQuality?.isQuoteStale, true);

  // Wide spread forces HOLD
  const wide = decideForSymbol(
    snapshotWithQuality({
      isMarketOpen: true,
      quoteAgeMs: 20_000,
      spreadPct: WIDE_SPREAD_HOLD_PCT + 0.005,
    }),
  );
  assert.equal(wide.action, "HOLD");
  assert.ok(wide.reasons.some((r) => /spread.*too wide/i.test(r)));

  // Data quality object shape
  const dq = assessDataQuality({
    isMarketOpen: false,
    quote: {
      symbol: "MSFT",
      bid: 1,
      ask: 2,
      bidSize: 1,
      askSize: 1,
      timestamp: new Date(now - 60_000).toISOString(),
    },
    bars: [],
    nowMs: now,
  });
  assert.equal(typeof dq.isMarketOpen, "boolean");
  assert.equal(typeof dq.isQuoteStale, "boolean");
  assert.ok("spreadPercent" in dq);
  assert.equal(typeof dq.hasRecentBars, "boolean");
  assert.ok(Array.isArray(dq.warningMessages));
  assert.ok(dq.warningMessages.length > 0);

  // Watchlist decisions respect closed market
  const decisions = generateWatchlistDecisions({
    symbols: ["AAPL", "MSFT"],
    quotes: [
      {
        symbol: "AAPL",
        bid: 100,
        ask: 100.05,
        bidSize: 1,
        askSize: 1,
        timestamp: new Date().toISOString(),
      },
      {
        symbol: "MSFT",
        bid: 200,
        ask: 200.05,
        bidSize: 1,
        askSize: 1,
        timestamp: new Date().toISOString(),
      },
    ],
    barsBySymbol: { AAPL: sampleBars(), MSFT: sampleBars() },
    isMarketOpen: false,
  });
  assert.equal(decisions.length, 2);
  for (const d of decisions) {
    assert.equal(d.action, "HOLD");
    assert.equal(d.paperOnly, true);
  }

  // Safety + execution still off
  try {
    assertPaperTradingOnly("https://api.alpaca.markets");
    assert.fail("live URL should throw");
  } catch (e) {
    assert.ok(e instanceof PaperTradingSafetyError);
  }
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  assert.equal(isPaperOrderExecutionEnabled(), false);
  await assert.rejects(
    () => placePaperOrder({ symbol: "AAPL", qty: 1, side: "buy" }),
    /disabled/i,
  );

  console.log("verify-phase2.5: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
