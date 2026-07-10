/**
 * Phase 6.5 verification:
 * - U.S. stocks only (crypto not added)
 * - order execution disabled by default
 * - manual approval required
 * - market closed / stale / high risk block orders
 * - live endpoint blocked
 * - no secrets logged
 * - multi-TF scoring + market condition present
 *
 * Run: npm run verify:phase6.5
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { placePaperOrder } from "../src/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import { isPaperOrderExecutionEnabled, parseWatchlist } from "../src/lib/config";
import { decideForSymbol, generateWatchlistDecisions } from "../src/lib/ai/decision";
import { evaluateOrderGates } from "../src/lib/trades/gates";
import { assessMarketCondition } from "../src/lib/stocks/market-condition";
import { analyzeStockTechnicals } from "../src/lib/stocks/technicals";
import {
  filterUsStockSymbols,
  isBlockedNonStockSymbol,
} from "../src/lib/stocks/universe";
import type { AlpacaBar, DataQuality, SymbolMarketSnapshot } from "../src/lib/alpaca/types";

function bar(
  t: string,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number,
): AlpacaBar {
  return { t, o, h, l, c, v };
}

function risingBars(n: number, start = 100): AlpacaBar[] {
  const out: AlpacaBar[] = [];
  for (let i = 0; i < n; i++) {
    const c = start + i * 0.4;
    out.push(
      bar(
        new Date(Date.now() - (n - i) * 60_000).toISOString(),
        c - 0.1,
        c + 0.2,
        c - 0.2,
        c,
        1000 + i * 50,
      ),
    );
  }
  return out;
}

function fallingBars(n: number, start = 100): AlpacaBar[] {
  const out: AlpacaBar[] = [];
  for (let i = 0; i < n; i++) {
    const c = start - i * 0.4;
    out.push(
      bar(
        new Date(Date.now() - (n - i) * 60_000).toISOString(),
        c + 0.1,
        c + 0.2,
        c - 0.2,
        c,
        1000 + i * 50,
      ),
    );
  }
  return out;
}

const goodDq: DataQuality = {
  isMarketOpen: true,
  isQuoteStale: false,
  spreadPercent: 0.001,
  hasRecentBars: true,
  warningMessages: [],
};

function snapshot(
  symbol: string,
  bars: AlpacaBar[],
  dq: DataQuality = goodDq,
): SymbolMarketSnapshot {
  const last = bars.at(-1)?.c ?? 100;
  return {
    symbol,
    bid: last - 0.05,
    ask: last + 0.05,
    mid: last,
    last,
    spreadPct: dq.spreadPercent,
    bars,
    timeframe: "5Min",
    quoteTimestamp: new Date().toISOString(),
    dataQuality: dq,
    bars1Min: bars,
    bars5Min: bars,
    bars15Min: bars,
  };
}

async function main() {
  // --- stocks only / crypto not added ---
  assert.equal(isBlockedNonStockSymbol("BTC"), true);
  assert.equal(isBlockedNonStockSymbol("ETHUSD"), true);
  assert.equal(isBlockedNonStockSymbol("BTC/USD"), true);
  assert.equal(isBlockedNonStockSymbol("AAPL"), false);
  assert.deepEqual(filterUsStockSymbols(["AAPL", "BTC", "MSFT"]), [
    "AAPL",
    "MSFT",
  ]);
  assert.deepEqual(parseWatchlist("AAPL,BTC,ETH,MSFT"), ["AAPL", "MSFT"]);

  const srcTree = [
    "src/lib/stocks",
    "src/lib/ai/decision.ts",
    "src/components/ControlRoom.tsx",
  ];
  for (const p of srcTree) {
    const text = fs.existsSync(p) && fs.statSync(p).isDirectory()
      ? fs
          .readdirSync(p)
          .map((f) => fs.readFileSync(`${p}/${f}`, "utf8"))
          .join("\n")
      : fs.readFileSync(p, "utf8");
    assert.equal(/crypto\s+trading/i.test(text), false);
    assert.equal(text.includes("placeCryptoOrder"), false);
  }

  // --- execution disabled by default ---
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  assert.equal(isPaperOrderExecutionEnabled(), false);
  await assert.rejects(
    () => placePaperOrder({ symbol: "AAPL", qty: 1, side: "buy" }),
    /disabled/i,
  );

  // --- live endpoint blocked ---
  try {
    assertPaperTradingOnly("https://api.alpaca.markets");
    assert.fail("live should be blocked");
  } catch (e) {
    assert.ok(e instanceof PaperTradingSafetyError);
  }

  // --- gates: market closed / stale / high risk / manual approval ---
  const closed = evaluateOrderGates({
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "low",
    dataQuality: { ...goodDq, isMarketOpen: false },
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
    requireManualApproval: true,
    manualApproved: true,
    confirmed: true,
  });
  assert.equal(closed.allowed, false);
  assert.ok(closed.blockers.some((b) => b.code === "market_closed"));

  const stale = evaluateOrderGates({
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "low",
    dataQuality: { ...goodDq, isQuoteStale: true },
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
    requireManualApproval: true,
    manualApproved: true,
    confirmed: true,
  });
  assert.equal(stale.allowed, false);
  assert.ok(stale.blockers.some((b) => b.code === "stale_quote"));

  const highRisk = evaluateOrderGates({
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "high",
    dataQuality: goodDq,
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
    requireManualApproval: true,
    manualApproved: true,
    confirmed: true,
  });
  assert.equal(highRisk.allowed, false);
  assert.ok(highRisk.blockers.some((b) => b.code === "high_risk"));

  const noApproval = evaluateOrderGates({
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY",
    side: "buy",
    riskStatus: "low",
    dataQuality: goodDq,
    qty: 1,
    estimatedPrice: 100,
    maxNotional: 500,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
    requireManualApproval: true,
    manualApproved: false,
    confirmed: false,
  });
  assert.equal(noApproval.allowed, false);
  assert.ok(noApproval.blockers.some((b) => b.code === "missing_approval"));

  // --- technicals + market condition ---
  const tech = analyzeStockTechnicals({
    bars1Min: risingBars(20),
    bars5Min: risingBars(20),
    bars15Min: risingBars(16),
    lastPrice: 108,
  });
  assert.ok(tech.technicalLean > 0);
  assert.ok(tech.vwap != null);
  assert.ok(tech.support != null && tech.resistance != null);

  const bullishMkt = assessMarketCondition({
    spyBars5Min: risingBars(20, 500),
    qqqBars5Min: risingBars(20, 400),
    spyBars15Min: risingBars(16, 500),
    qqqBars15Min: risingBars(16, 400),
  });
  assert.equal(bullishMkt.label, "bullish");

  const bearishMkt = assessMarketCondition({
    spyBars5Min: fallingBars(20, 500),
    qqqBars5Min: fallingBars(20, 400),
    spyBars15Min: fallingBars(16, 500),
    qqqBars15Min: fallingBars(16, 400),
  });
  assert.equal(bearishMkt.label, "bearish");

  // Closed market → HOLD + high risk + not ready
  const closedDecision = decideForSymbol(
    snapshot("AAPL", risingBars(20), {
      ...goodDq,
      isMarketOpen: false,
      isQuoteStale: true,
      warningMessages: ["closed"],
    }),
    undefined,
    bullishMkt,
  );
  assert.equal(closedDecision.action, "HOLD");
  assert.equal(closedDecision.readyForManualPaperTrade, false);
  assert.ok(closedDecision.scores);
  assert.ok(closedDecision.explanation?.technical);
  assert.ok(closedDecision.explanation?.market);
  assert.ok(closedDecision.explanation?.risk);
  assert.equal(closedDecision.assetClass, "us_equity");

  // Weak market avoids BUY even with rising stock
  const weakBuy = decideForSymbol(
    snapshot("AAPL", risingBars(24)),
    undefined,
    bearishMkt,
  );
  assert.notEqual(weakBuy.action, "BUY");

  // Watchlist filters crypto
  const decisions = generateWatchlistDecisions({
    symbols: ["AAPL", "BTC"],
    quotes: [
      {
        symbol: "AAPL",
        bid: 100,
        ask: 100.1,
        bidSize: 1,
        askSize: 1,
        timestamp: new Date().toISOString(),
      },
    ],
    barsBySymbol: { AAPL: risingBars(20) },
    bars5MinBySymbol: { AAPL: risingBars(20) },
    isMarketOpen: false,
    marketCondition: bullishMkt,
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].symbol, "AAPL");

  // --- no secrets logged ---
  for (const f of [
    "src/lib/stocks/scoring.ts",
    "src/lib/stocks/technicals.ts",
    "src/lib/stocks/market-condition.ts",
    "src/lib/stocks/fetch-context.ts",
    "src/lib/ai/decision.ts",
  ]) {
    const src = fs.readFileSync(f, "utf8");
    assert.equal(src.includes("console.log"), false, `${f} must not console.log`);
    assert.equal(src.includes("ALPACA_SECRET_KEY"), false);
    assert.equal(src.includes("FINNHUB_API_KEY"), false);
  }

  // 15Min timeframe supported in client
  const clientSrc = fs.readFileSync("src/lib/alpaca/client.ts", "utf8");
  assert.ok(clientSrc.includes('"15Min"'));

  console.log("verify-phase6.5: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
