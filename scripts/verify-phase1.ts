/**
 * Phase 1 verification: safety guard + order execution gate.
 * Run: npm run verify:phase1
 */
import assert from "node:assert/strict";
import {
  assertPaperTradingOnly,
  assertSafeTradingRequestUrl,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import { placePaperOrder } from "../src/lib/alpaca/client";

function expectSafetyThrow(fn: () => void, label: string) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = e instanceof PaperTradingSafetyError;
  }
  assert.equal(threw, true, `expected PaperTradingSafetyError for ${label}`);
}

async function main() {
  // 4. Safety guard rejects live URL
  assertPaperTradingOnly("https://paper-api.alpaca.markets");
  assertPaperTradingOnly("https://paper-api.alpaca.markets/");
  expectSafetyThrow(
    () => assertPaperTradingOnly("https://api.alpaca.markets"),
    "live base URL",
  );
  expectSafetyThrow(
    () => assertPaperTradingOnly("https://api.alpaca.markets/v2"),
    "live base URL with path",
  );
  expectSafetyThrow(
    () => assertPaperTradingOnly("https://evil.example.com"),
    "unknown host",
  );
  expectSafetyThrow(
    () => assertSafeTradingRequestUrl("https://api.alpaca.markets/v2/orders"),
    "live request URL",
  );
  assertSafeTradingRequestUrl("https://paper-api.alpaca.markets/v2/account");

  // 7. Order execution disabled unless explicitly enabled
  delete process.env.ENABLE_PAPER_ORDER_EXECUTION;
  await assert.rejects(
    () =>
      placePaperOrder({
        symbol: "AAPL",
        qty: 1,
        side: "buy",
      }),
    /disabled/i,
  );

  console.log("verify-phase1: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
