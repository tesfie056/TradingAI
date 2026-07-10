/**
 * Small Account Mode verification:
 * - $10 AAPL order sends notional=10 only (no qty)
 * - recent orders display notional and fractional qty
 * - max notional enforced
 * - live trading remains blocked
 *
 * Run: npm run verify:small-account
 */
import assert from "node:assert/strict";
import { buildAlpacaOrderBody } from "../src/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import {
  getDefaultNotionalAmount,
  getDefaultOrderMode,
  getMaxNotionalPerTrade,
  getMaxStockPrice,
  isSmallAccountMode,
} from "../src/lib/config";
import { evaluateOrderGates } from "../src/lib/trades/gates";
import { parsePaperOrderBody } from "../src/lib/trades/parse-order-body";
import {
  evaluateSmallAccountCandidate,
  isOtcExchange,
} from "../src/lib/stocks/small-account";
import {
  formatFractionalQty,
  formatOrderModeLabel,
  formatTradeNotional,
  mapAlpacaOrderToTradeRow,
} from "../src/lib/trades/trade-display";
import type { DataQuality } from "../src/lib/alpaca/types";
import type { AlpacaOrder } from "../src/lib/alpaca/types";

const goodDq: DataQuality = {
  isMarketOpen: true,
  isQuoteStale: false,
  spreadPercent: 0.002,
  hasRecentBars: true,
  warningMessages: [],
};

function gateBase(
  overrides: Partial<Parameters<typeof evaluateOrderGates>[0]> = {},
) {
  return {
    executionEnabled: true,
    paperEndpointOk: true,
    action: "BUY" as const,
    side: "buy" as const,
    riskStatus: "low" as const,
    dataQuality: goodDq,
    orderMode: "quantity" as const,
    qty: 1,
    notional: null,
    estimatedPrice: 25,
    maxNotional: 25,
    dailyTradeCount: 0,
    maxDailyTrades: 5,
    ...overrides,
  };
}

// --- $10 AAPL notional only ---
const aapl10 = buildAlpacaOrderBody({
  symbol: "AAPL",
  notional: 10,
  side: "buy",
});
assert.equal(aapl10.symbol, "AAPL");
assert.equal(aapl10.notional, "10");
assert.equal(aapl10.qty, undefined);

const qtyBody = buildAlpacaOrderBody({
  symbol: "F",
  qty: 2,
  side: "buy",
});
assert.equal(qtyBody.qty, "2");
assert.equal(qtyBody.notional, undefined);

assert.throws(() =>
  parsePaperOrderBody({
    symbol: "AAPL",
    side: "buy",
    qty: 1,
    notional: 10,
  }),
);

const notionalParsed = parsePaperOrderBody({
  symbol: "AAPL",
  side: "buy",
  orderMode: "notional",
  notional: 10,
});
assert.equal(notionalParsed.orderMode, "notional");
assert.equal(notionalParsed.notional, 10);
assert.equal(notionalParsed.qty, undefined);

// --- recent order row mapping ---
const mockOrder = {
  id: "ord-1",
  client_order_id: "c1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  submitted_at: "2026-01-01T00:00:00Z",
  filled_at: "2026-01-01T00:01:00Z",
  expired_at: null,
  canceled_at: null,
  failed_at: null,
  asset_id: "a1",
  symbol: "AAPL",
  asset_class: "us_equity",
  qty: null,
  notional: "10",
  filled_qty: "0.159435358",
  filled_avg_price: "188.50",
  order_class: "",
  order_type: "market",
  type: "market",
  side: "buy",
  time_in_force: "day",
  limit_price: null,
  stop_price: null,
  status: "filled",
  extended_hours: false,
} satisfies AlpacaOrder;

const row = mapAlpacaOrderToTradeRow(mockOrder);
assert.equal(row.orderMode, "notional");
assert.equal(row.notional, "10");
assert.equal(formatOrderModeLabel(row.orderMode), "Dollar");
assert.equal(formatTradeNotional(row.notional), "$10");
assert.equal(formatFractionalQty(row.filledQty, row.qty), "0.159435");

// --- max notional gate ---
const blocked = evaluateOrderGates(
  gateBase({
    orderMode: "notional",
    notional: 30,
    qty: 0,
    maxNotional: 25,
  }),
);
assert.ok(blocked.blockers.some((b) => b.code === "max_notional"));

const allowed = evaluateOrderGates(
  gateBase({
    orderMode: "notional",
    notional: 10,
    qty: 0,
    maxNotional: 25,
  }),
);
assert.equal(allowed.allowed, true);

// --- defaults ---
assert.equal(getDefaultOrderMode(), "notional");
assert.equal(getDefaultNotionalAmount(), 10);

// --- small account candidate filters ---
const penny = evaluateSmallAccountCandidate({
  symbol: "PENNY",
  price: 0.5,
  spreadPercent: 0.001,
  avgDailyVolume: 2_000_000,
  exchange: "NASDAQ",
});
assert.equal(penny.eligible, false);

const otc = evaluateSmallAccountCandidate({
  symbol: "OTC",
  price: 8,
  spreadPercent: 0.001,
  avgDailyVolume: 2_000_000,
  exchange: "OTCBB",
  filters: { avoidOtc: true, majorExchangeOnly: true },
});
assert.equal(otc.eligible, false);
assert.ok(isOtcExchange("OTCBB"));

assert.throws(
  () => assertPaperTradingOnly("https://api.alpaca.markets"),
  PaperTradingSafetyError,
);

const max = getMaxNotionalPerTrade();
assert.ok(max > 0);
const cap = getMaxStockPrice();
assert.ok(cap >= 2);
console.log(
  `Small account mode: ${isSmallAccountMode() ? "ON" : "OFF"} · default notional $${getDefaultNotionalAmount()} · max $${max}`,
);
console.log("verify:small-account — all checks passed");
