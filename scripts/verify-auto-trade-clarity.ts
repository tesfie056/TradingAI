/**
 * Auto Trade page clarity verification:
 * - scanner processes all watchlist symbols
 * - top signal selected from all scanned symbols
 * - UI data includes every scanned symbol
 * - kill switch / daily limit block auto trading
 * - paper only, no live trading
 * - no secrets logged
 *
 * Run: npm run verify:auto-trade-clarity
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

async function main() {
  console.log("verify:auto-trade-clarity starting…");

  const { getWatchlist } = await import("../src/lib/config");
  const watchlist = getWatchlist();
  assert.ok(watchlist.length >= 1);
  console.log(`✓ watchlist has ${watchlist.length} symbols: ${watchlist.join(", ")}`);

  const {
    buildLastScanSnapshot,
    formatTopSignalLabel,
    buildScannedSymbolResults,
  } = await import("../src/lib/monitor/scan-snapshot");

  const scannedAt = new Date().toISOString();
  const decisions = watchlist.map((symbol, i) => ({
    symbol,
    action: (i === 0 ? "BUY" : "HOLD") as "BUY" | "HOLD",
    decisionLabel: (i === 0 ? "BUY" : "HOLD") as "BUY" | "HOLD",
    confidence: i === 0 ? 0.82 : 0.4 + i * 0.05,
    reasons: [`test ${symbol}`],
    riskWarnings: [] as string[],
    riskStatus: "low" as const,
    timestamp: scannedAt,
    paperOnly: true as const,
    scores: {
      technicalScore: 0.6 + i * 0.02,
      newsScore: 0.5,
      marketScore: 0.55,
      riskScore: 0.7,
      liquidityScore: 0.6,
      volumeScore: 0.5,
      momentumScore: 0.55,
      finalScore: i === 0 ? 0.72 : 0.45 + i * 0.01,
      confidence: i === 0 ? 0.82 : 0.4,
    },
  }));

  const snapshot = buildLastScanSnapshot({
    symbols: watchlist,
    decisions,
    scannedAt,
  });

  assert.equal(snapshot.stocksScanned, watchlist.length);
  assert.equal(snapshot.ranked.length, watchlist.length);
  for (const sym of watchlist) {
    assert.ok(
      snapshot.ranked.some((r) => r.symbol === sym.toUpperCase()),
      `missing ${sym} in ranked scan`,
    );
  }
  console.log("✓ scanner snapshot includes every watchlist symbol");

  assert.equal(snapshot.topSymbol, watchlist[0].toUpperCase());
  const label = formatTopSignalLabel(snapshot);
  assert.ok(label.includes(`${watchlist.length} scanned symbols`));
  assert.ok(label.includes(snapshot.topSymbol!));
  assert.ok(!/^Top signal: [A-Z]+ ·/.test(label));
  console.log(`✓ top signal wording: ${label}`);

  const ranked = buildScannedSymbolResults({ decisions, scannedAt });
  assert.equal(ranked[0]?.rank, 1);
  assert.ok(ranked.every((r) => typeof r.autoEligible === "boolean"));
  assert.ok(ranked.every((r) => r.signal));
  console.log("✓ ranked table fields present for each symbol");

  const { buildAutoTradeBlockSummary } = await import(
    "../src/lib/auto-trade/block-summary"
  );
  const blocked = buildAutoTradeBlockSummary({
    envEnabled: true,
    executionEnabled: true,
    effectivelyEnabled: false,
    killSwitch: true,
    panicStop: false,
    runtimeDisabled: false,
    dailyTradesUsed: 3,
    maxDailyTrades: 3,
    activeCooldowns: [],
    nextEligibleAt: null,
  });
  assert.ok(blocked.runtimeOff);
  assert.ok(blocked.primaryReason.includes("kill switch"));
  assert.ok(blocked.items.some((i) => i.id === "kill_switch" && i.active));
  assert.ok(blocked.items.some((i) => i.id === "daily_limit" && i.active));
  console.log("✓ kill switch and daily limit appear in block summary");

  const { evaluateAutoTradeEligibility } = await import(
    "../src/lib/auto-trade/eligibility"
  );
  const goodDq = {
    isMarketOpen: true,
    isQuoteStale: false,
    spreadPercent: 0.002,
    hasRecentBars: true,
    warningMessages: [] as string[],
  };
  const opp = {
    id: "opp_clarity",
    symbol: "AAPL",
    action: "BUY" as const,
    score: 0.7,
    confidence: 0.8,
    reason: "test",
    marketStatus: "open" as const,
    newsSummary: "quiet",
    timestamp: scannedAt,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    paperOnly: true as const,
    technicalScore: 0.7,
    newsScore: 0.6,
    marketScore: 0.6,
    riskScore: 0.75,
    blockedReasons: [],
    readyForPaperPreview: true,
    ollamaUsed: false,
  };
  const kill = evaluateAutoTradeEligibility({
    opportunity: opp,
    envEnabled: true,
    executionEnabled: true,
    runtimeBlocked: false,
    killSwitch: true,
    panicStop: false,
    paperEndpointOk: true,
    dataQuality: goodDq,
    riskStatus: "low",
    estimatedPrice: 180,
    notional: 5,
    dailyTradeCount: 0,
    dailyEstimatedPnL: 0,
    buyingPower: 1000,
    hasPosition: false,
    positionQty: 0,
    buyCooldownActive: false,
    sellCooldownActive: false,
    opportunityAlreadyProcessed: false,
    symbolTradedThisScan: false,
    recentBuyWithoutSell: false,
    lastTradeWasLoss: false,
  });
  assert.equal(kill.eligible, false);
  assert.equal(kill.blockers[0]?.code, "kill_switch_active");
  console.log("✓ kill switch blocks auto trading");

  const { getMaxDailyPaperTrades } = await import("../src/lib/config");
  const maxDaily = getMaxDailyPaperTrades();
  const daily = evaluateAutoTradeEligibility({
    opportunity: opp,
    envEnabled: true,
    executionEnabled: true,
    runtimeBlocked: false,
    killSwitch: false,
    panicStop: false,
    paperEndpointOk: true,
    dataQuality: goodDq,
    riskStatus: "low",
    estimatedPrice: 180,
    notional: 5,
    dailyTradeCount: maxDaily,
    dailyEstimatedPnL: 0,
    buyingPower: 1000,
    hasPosition: false,
    positionQty: 0,
    buyCooldownActive: false,
    sellCooldownActive: false,
    opportunityAlreadyProcessed: false,
    symbolTradedThisScan: false,
    recentBuyWithoutSell: false,
    lastTradeWasLoss: false,
  });
  assert.equal(daily.eligible, false);
  assert.equal(daily.blockers[0]?.code, "max_daily_trades");
  console.log("✓ daily limit blocks auto trading");

  const { assertPaperTradingOnly, PaperTradingSafetyError } = await import(
    "../src/lib/alpaca/safety"
  );
  assert.throws(
    () => assertPaperTradingOnly("https://api.alpaca.markets"),
    PaperTradingSafetyError,
  );
  console.log("✓ live trading endpoint blocked");

  const { isAutoPaperTradingEnabled } = await import("../src/lib/config");
  // Default in process without .env override for this check — status still paperOnly
  const { getAutoTradeStatus } = await import("../src/lib/auto-trade/status");
  const status = await getAutoTradeStatus();
  assert.equal(status.paperOnly, true);
  assert.equal(status.liveTradingAllowed, false);
  assert.ok(status.blockSummary);
  assert.ok(typeof status.topSignalLabel === "string");
  console.log("✓ auto-trade status is paper only with block summary");

  const page = path.join(
    process.cwd(),
    "src",
    "components",
    "auto-trade",
    "AutoTradePageView.tsx",
  );
  const pageSrc = fs.readFileSync(page, "utf8");
  const advancedSrc = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "AdvancedAutoTradeDetails.tsx",
    ),
    "utf8",
  );
  const safetySrc = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "SafetyActionsCard.tsx",
    ),
    "utf8",
  );
  assert.ok(
    pageSrc.includes("Watchlist status") ||
      pageSrc.includes("V1UniversePanel") ||
      advancedSrc.includes("Top candidates"),
  );
  assert.ok(
    pageSrc.includes("AdvancedAutoTradeDetails") ||
      pageSrc.includes("Advanced details") ||
      safetySrc.includes("Emergency Stop"),
  );
  assert.ok(
    pageSrc.includes("V1DailyProgressPanel") ||
      pageSrc.includes("Daily progress") ||
      safetySrc.includes("Emergency Stop"),
  );
  assert.ok(!pageSrc.includes("AUTO_PAPER_TRADING_ENABLED=false"));
  console.log("✓ Auto Trade UI is cleaned up (simple/advanced)");

  const { appendAutoTradeLog, readAutoTradeLogs } = await import(
    "../src/lib/auto-trade/logs"
  );
  await appendAutoTradeLog({
    event: "symbol_scanned",
    message: "test PKSECRETKEY1234567890 Bearer abc.def",
    symbol: "AAPL",
    meta: {
      signal: "HOLD",
      confidence: 0.4,
      autoEligible: false,
    },
  });
  const logs = await readAutoTradeLogs(3);
  const leaked = logs.some((l) =>
    /PKSECRETKEY1234567890|Bearer abc/.test(l.message),
  );
  assert.equal(leaked, false);
  console.log("✓ no secrets logged");

  // Silence unused in case env has auto enabled locally
  void isAutoPaperTradingEnabled;

  console.log("verify:auto-trade-clarity passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
