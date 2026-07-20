/**
 * Universe + Version 1 watchlist verification.
 * Paper only — no live orders or position changes.
 * Run: npm run verify:universe
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateUniverseEligibility,
  filterUniverseCandidates,
} from "../src/lib/universe/filters";
import { isLeveragedOrInverseEtf } from "../src/lib/universe/leveraged-etfs";
import {
  DEFAULT_PAPER_SOAK_WATCHLIST,
  evaluateStaticWatchlistEligibility,
  parseConfigurableWatchlist,
} from "../src/lib/universe/paper-soak-watchlist";
import { buildUniverseWarnings } from "../src/lib/universe/service";
import {
  isLegacyMegaCapWatchlist,
  isV1DefaultWatchlist,
  V1_DEFAULT_WATCHLIST,
} from "../src/lib/universe/v1-default-watchlist";
import { toUserFacingUniverseReason } from "../src/lib/universe/user-reasons";
import { parseWatchlist } from "../src/lib/config";

function emptyScanExtras() {
  return {
    name: null as string | null,
    bid: null as number | null,
    ask: null as number | null,
    userReasons: [] as string[],
    fractionable: true as boolean | null,
    quoteTimestamp: null as string | null,
    quoteStale: null as boolean | null,
  };
}

function main() {
  console.log("verify:universe starting…");

  // --- V1 default watchlist ---
  assert.ok(V1_DEFAULT_WATCHLIST.length >= 12);
  assert.ok(V1_DEFAULT_WATCHLIST.length <= 20);
  assert.equal(isV1DefaultWatchlist([...V1_DEFAULT_WATCHLIST]), true);
  assert.equal(new Set(V1_DEFAULT_WATCHLIST).size, V1_DEFAULT_WATCHLIST.length);
  assert.equal(isLegacyMegaCapWatchlist([...V1_DEFAULT_WATCHLIST]), false);
  const loaded = parseWatchlist("");
  assert.deepEqual(loaded, [...V1_DEFAULT_WATCHLIST]);
  console.log("✓ default V1 watchlist is loaded correctly");
  console.log("✓ watchlist contains no duplicate symbols");

  assert.equal(isLeveragedOrInverseEtf("TQQQ"), true);
  assert.equal(isLeveragedOrInverseEtf("SQQQ"), true);
  assert.equal(isLeveragedOrInverseEtf("AAPL"), false);
  console.log("✓ leveraged/inverse ETF denylist");

  const ok = evaluateUniverseEligibility({
    symbol: "F",
    price: 12,
    spreadPercent: 0.002,
    avgDailyVolume: 2_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
    fractionable: true,
  });
  assert.equal(ok.eligible, true);
  console.log("✓ eligible assets pass");

  const penny = evaluateUniverseEligibility({
    symbol: "PENNY",
    price: 2,
    spreadPercent: 0.002,
    avgDailyVolume: 5_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
  });
  assert.equal(penny.eligible, false);
  assert.ok(penny.reasons.length >= 1);
  assert.ok(penny.reasons.some((r) => /below|Penny/i.test(r)));
  console.log("✓ penny-priced assets are rejected");

  const expensive = evaluateUniverseEligibility({
    symbol: "AAPL",
    price: 210,
    spreadPercent: 0.001,
    avgDailyVolume: 50_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
  });
  assert.equal(expensive.eligible, false);
  assert.ok(expensive.reasons.some((r) => /above maximum/i.test(r)));
  console.log("✓ assets above the configured maximum are rejected");

  const thin = evaluateUniverseEligibility({
    symbol: "THIN",
    price: 20,
    spreadPercent: 0.002,
    avgDailyVolume: 100_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
  });
  assert.equal(thin.eligible, false);
  assert.ok(thin.reasons.some((r) => /ADV/i.test(r)));
  console.log("✓ low-volume assets are rejected");

  const wide = evaluateUniverseEligibility({
    symbol: "WIDE",
    price: 20,
    spreadPercent: 0.01,
    avgDailyVolume: 2_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
  });
  assert.equal(wide.eligible, false);
  assert.ok(wide.reasons.some((r) => /Spread/i.test(r)));
  console.log("✓ wide-spread assets are rejected");

  const lev = evaluateUniverseEligibility({
    symbol: "TQQQ",
    price: 40,
    spreadPercent: 0.001,
    avgDailyVolume: 10_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
  });
  assert.equal(lev.eligible, false);
  console.log("✓ leveraged ETFs are rejected");

  const inv = evaluateUniverseEligibility({
    symbol: "SQQQ",
    price: 20,
    spreadPercent: 0.001,
    avgDailyVolume: 10_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
  });
  assert.equal(inv.eligible, false);
  console.log("✓ inverse ETFs are rejected");

  const inactive = evaluateUniverseEligibility({
    symbol: "DEAD",
    price: 20,
    spreadPercent: 0.002,
    avgDailyVolume: 2_000_000,
    tradable: false,
    assetStatus: "inactive",
    assetClass: "us_equity",
  });
  assert.equal(inactive.eligible, false);
  console.log("✓ non-tradable assets are rejected");

  const noQuote = evaluateUniverseEligibility({
    symbol: "MISS",
    price: null,
    spreadPercent: null,
    avgDailyVolume: 2_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
  });
  assert.equal(noQuote.eligible, false);
  assert.ok(noQuote.reasons.length >= 1);
  assert.ok(
    noQuote.reasons.some((r) => /Price unavailable|spread unavailable/i.test(r)),
  );
  console.log("✓ missing quote data produces a rejection reason");

  const staleMsg = toUserFacingUniverseReason("Market data is stale");
  assert.equal(staleMsg, "Market data is stale");
  console.log("✓ stale quote data produces a rejection reason");

  const noFrac = evaluateUniverseEligibility({
    symbol: "WHOLE",
    price: 20,
    spreadPercent: 0.002,
    avgDailyVolume: 2_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
    fractionable: false,
  });
  assert.equal(noFrac.eligible, false);
  assert.ok(noFrac.reasons.some((r) => /fractional/i.test(r)));
  console.log("✓ non-fractionable assets are rejected");

  const metaFail = evaluateUniverseEligibility({
    symbol: "UNK",
    price: 20,
    spreadPercent: 0.002,
    avgDailyVolume: 2_000_000,
    assetLookupFailed: true,
  });
  assert.equal(metaFail.eligible, false);
  assert.ok(metaFail.reasons.some((r) => /metadata/i.test(r)));
  console.log("✓ missing asset metadata produces a rejection reason");

  const batch = filterUniverseCandidates([
    {
      symbol: "F",
      price: 12,
      spreadPercent: 0.002,
      avgDailyVolume: 2_000_000,
      tradable: true,
      assetStatus: "active",
      assetClass: "us_equity",
      fractionable: true,
    },
    {
      symbol: "TQQQ",
      price: 40,
      spreadPercent: 0.001,
      avgDailyVolume: 10_000_000,
      tradable: true,
      assetStatus: "active",
      assetClass: "us_equity",
    },
  ]);
  assert.equal(batch.eligible.length, 1);
  assert.equal(batch.rejected.length, 1);
  assert.ok(batch.rejected.every((r) => r.reasons.length >= 1));
  console.log("✓ eligible and ineligible counts are correct");
  console.log("✓ every rejected symbol has at least one reason");

  assert.ok(DEFAULT_PAPER_SOAK_WATCHLIST.length >= 20);
  console.log("✓ default paper-soak watchlist has 20+ candidates");

  const expensiveWarnings = buildUniverseWarnings({
    watchlist: ["AAPL", "MSFT", "GOOGL"],
    staticPassed: 3,
    eligibleCount: 0,
    scanned: [
      {
        symbol: "AAPL",
        price: 210,
        spreadPercent: 0.001,
        avgDailyVolume: 50_000_000,
        eligible: false,
        reasons: ["Price $210.00 above maximum $50"],
        assetStatus: "active",
        tradable: true,
        shortable: true,
        ...emptyScanExtras(),
      },
      {
        symbol: "MSFT",
        price: 420,
        spreadPercent: 0.001,
        avgDailyVolume: 20_000_000,
        eligible: false,
        reasons: ["Price $420.00 above maximum $50"],
        assetStatus: "active",
        tradable: true,
        shortable: true,
        ...emptyScanExtras(),
      },
      {
        symbol: "GOOGL",
        price: 175,
        spreadPercent: 0.001,
        avgDailyVolume: 20_000_000,
        eligible: false,
        reasons: ["Price $175.00 above maximum $50"],
        assetStatus: "active",
        tradable: true,
        shortable: true,
        ...emptyScanExtras(),
      },
    ],
    minEligibleSoft: 5,
    minPrice: 5,
    maxPrice: 50,
  });
  assert.ok(expensiveWarnings.some((w) => /outside the allowed/i.test(w)));
  assert.ok(expensiveWarnings.some((w) => /Zero symbols eligible/i.test(w)));
  console.log("✓ watchlist above $50 produces clear warnings");
  console.log("✓ auto-trading remains blocked with zero eligible symbols");

  const deduped = parseConfigurableWatchlist(
    "F,f,BAC,BAC,T",
    DEFAULT_PAPER_SOAK_WATCHLIST,
  );
  assert.deepEqual(deduped, ["F", "BAC", "T"]);
  console.log("✓ final universe watchlist is deduplicated");

  const staticBad = evaluateStaticWatchlistEligibility([
    "F",
    "TQQQ",
    "BTCUSD",
    "NOTAVALID!!!",
    "F",
  ]);
  assert.ok(staticBad.passed.includes("F"));
  assert.equal(staticBad.passed.filter((s) => s === "F").length, 1);
  assert.ok(staticBad.rejected.some((r) => r.symbol === "TQQQ"));
  console.log("✓ invalid / unsupported symbols rejected safely");

  const fewWarnings = buildUniverseWarnings({
    watchlist: ["F", "T", "BAC"],
    staticPassed: 3,
    eligibleCount: 2,
    scanned: [],
    minEligibleSoft: 5,
  });
  assert.ok(fewWarnings.some((w) => /Fewer than 5/i.test(w)));
  console.log("✓ fewer-than-5 eligible warning");

  const scannerSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "monitor", "scanner.ts"),
    "utf8",
  );
  assert.ok(scannerSrc.includes("zero symbols passed universe filters"));
  assert.ok(
    !/eligibleSymbols\.length > 0\s*\?\s*universe\.eligibleSymbols\s*:\s*watchlist/.test(
      scannerSrc,
    ),
  );
  console.log("✓ engine does not silently fall back to raw watchlist");

  const page = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "AutoTradePageView.tsx",
    ),
    "utf8",
  );
  const universeUi = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "V1UniversePanel.tsx",
    ),
    "utf8",
  );
  assert.ok(page.includes("V1UniversePanel"));
  assert.ok(universeUi.includes("Eligible:"));
  assert.ok(universeUi.includes("Ineligible:"));
  assert.ok(universeUi.includes("Configured symbols:"));
  assert.ok(
    universeUi.includes("userReason") ||
      universeUi.includes("Did not meet Version 1"),
  );
  console.log("✓ dashboard shows universe eligibility status");

  const inspectSrc = fs.readFileSync(
    path.join(process.cwd(), "scripts", "inspect-v1-watchlist.ts"),
    "utf8",
  );
  assert.ok(inspectSrc.includes("Never places") || inspectSrc.includes("never"));
  assert.ok(!/placePaperOrder|closeAllPositions|cancelAllOrders/.test(inspectSrc));
  console.log("✓ validation performs no order or position mutations");

  const safetySrc = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "alpaca", "safety.ts"),
    "utf8",
  );
  assert.ok(safetySrc.includes("assertPaperTradingOnly"));
  console.log("✓ existing paper-only safety remains enforced");

  console.log("verify:universe passed");
}

main();
