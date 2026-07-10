/**
 * Phase A — universe filter unit tests.
 * Run: npx tsx scripts/verify-universe.ts
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

function main() {
  console.log("verify:universe starting…");

  assert.equal(isLeveragedOrInverseEtf("TQQQ"), true);
  assert.equal(isLeveragedOrInverseEtf("AAPL"), false);
  console.log("✓ leveraged/inverse ETF denylist");

  const ok = evaluateUniverseEligibility({
    symbol: "AAPL",
    price: 25,
    spreadPercent: 0.002,
    avgDailyVolume: 2_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
  });
  assert.equal(ok.eligible, true);
  console.log("✓ liquid mid-price stock passes");

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
  assert.ok(penny.reasons.some((r) => /below|Penny/i.test(r)));
  console.log("✓ price / penny filter");

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
  console.log("✓ volume filter");

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
  console.log("✓ spread filter");

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
  console.log("✓ leveraged ETF excluded");

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
  console.log("✓ inactive / non-tradable excluded");

  const shortReq = evaluateUniverseEligibility({
    symbol: "NOSH",
    price: 20,
    spreadPercent: 0.002,
    avgDailyVolume: 2_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
    shortable: false,
    requiresShorting: true,
  });
  assert.equal(shortReq.eligible, false);
  console.log("✓ non-shortable rejected when shorting required");

  const batch = filterUniverseCandidates([
    {
      symbol: "AAPL",
      price: 25,
      spreadPercent: 0.002,
      avgDailyVolume: 2_000_000,
      tradable: true,
      assetStatus: "active",
      assetClass: "us_equity",
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
  console.log("✓ batch filterUniverseCandidates");

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
      },
    ],
    minEligibleSoft: 5,
    minPrice: 5,
    maxPrice: 50,
  });
  assert.ok(
    expensiveWarnings.some((w) => /outside the allowed/i.test(w)),
    "expected price-range warning",
  );
  assert.ok(
    expensiveWarnings.some((w) => /Zero symbols eligible/i.test(w)),
    "expected zero-eligible warning",
  );
  console.log("✓ watchlist above $50 produces clear warnings");

  const midOk = evaluateUniverseEligibility({
    symbol: "F",
    price: 12.5,
    spreadPercent: 0.002,
    avgDailyVolume: 40_000_000,
    tradable: true,
    assetStatus: "active",
    assetClass: "us_equity",
  });
  assert.equal(midOk.eligible, true);
  console.log("✓ eligible lower-priced stock passes when filters met");

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
  assert.ok(staticBad.rejected.length >= 2);
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
  assert.ok(page.includes("Final eligible universe"));
  assert.ok(page.includes("Rejected by price"));
  console.log("✓ dashboard shows universe filter breakdown");

  console.log("verify:universe passed");
}

main();
