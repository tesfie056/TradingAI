/**
 * Broker clock source-of-truth, timezone, cache, and unavailable-vs-closed.
 * Run: npm run verify:market-clock
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const MONDAY_1PM_ET_UTC = Date.parse("2026-07-20T17:00:00.000Z"); // 1:00 PM EDT
const SATURDAY_NOON_ET_UTC = Date.parse("2026-07-18T16:00:00.000Z");
const DST_SPRING_UTC = Date.parse("2026-03-08T12:00:00.000Z"); // after US spring forward
const DST_FALL_UTC = Date.parse("2026-11-01T12:00:00.000Z"); // after US fall back

async function main() {
  console.log("verify:market-clock starting…");

  const {
    easternWallTime,
    localRegularSessionOpen,
    getFreshBrokerClock,
    resetBrokerClockCacheForTests,
    setBrokerClockFetcherForTests,
    marketStatusLabel,
  } = await import("../src/lib/market/broker-clock");
  const { decisionToOpportunity } = await import(
    "../src/lib/monitor/opportunity"
  );
  const { primaryBlockReason, monitorTradeStatus } = await import(
    "../src/lib/monitor/display"
  );
  const { evaluateAutoTradeEligibility } = await import(
    "../src/lib/auto-trade/eligibility"
  );
  const { buildSystemStatusItems } = await import(
    "../src/lib/client/status-state-mapper"
  );

  // 1) Monday 1:00 PM America/New_York — local session open
  {
    const et = easternWallTime(MONDAY_1PM_ET_UTC);
    assert.equal(et.weekday, "Mon");
    assert.equal(et.hour, 13);
    assert.equal(et.minute, 0);
    assert.equal(localRegularSessionOpen(MONDAY_1PM_ET_UTC), true);
    console.log("✓ Monday 1:00 PM ET local session reports open");
  }

  // 2) Same instant as 17:00 UTC
  {
    assert.equal(localRegularSessionOpen(Date.parse("2026-07-20T17:00:00Z")), true);
    console.log("✓ 17:00 UTC maps to open regular session");
  }

  // 3–4) Cache + Alpaca wins over local
  {
    resetBrokerClockCacheForTests();
    let calls = 0;
    setBrokerClockFetcherForTests(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          isOpen: false,
          timestamp: "2026-07-20T08:00:00Z",
          nextOpen: "2026-07-20T13:30:00Z",
          nextClose: "2026-07-20T20:00:00Z",
          paperOnly: true as const,
        };
      }
      return {
        isOpen: true,
        timestamp: "2026-07-20T17:00:00Z",
        nextOpen: "2026-07-21T13:30:00Z",
        nextClose: "2026-07-20T20:00:00Z",
        paperOnly: true as const,
      };
    });

    const closed = await getFreshBrokerClock({
      force: true,
      nowMs: MONDAY_1PM_ET_UTC - 60_000,
    });
    assert.equal(closed.status, "closed");
    assert.equal(closed.isOpen, false);

    const openFresh = await getFreshBrokerClock({
      force: true,
      nowMs: MONDAY_1PM_ET_UTC,
    });
    assert.equal(openFresh.status, "open");
    assert.equal(openFresh.isOpen, true);
    console.log("✓ stale closed cache replaced by fresh open clock");

    // Alpaca open while local would say closed (Saturday wall) — Alpaca wins
    resetBrokerClockCacheForTests();
    setBrokerClockFetcherForTests(async () => ({
      isOpen: true,
      timestamp: "2026-07-18T16:00:00Z",
      nextOpen: "2026-07-20T13:30:00Z",
      nextClose: "2026-07-18T20:00:00Z",
      paperOnly: true as const,
    }));
    assert.equal(localRegularSessionOpen(SATURDAY_NOON_ET_UTC), false);
    const alpacaWins = await getFreshBrokerClock({
      force: true,
      nowMs: SATURDAY_NOON_ET_UTC,
    });
    assert.equal(alpacaWins.status, "open");
    console.log("✓ Alpaca open wins over local closed estimate");

    // 5) Clock failure → unavailable, not closed
    resetBrokerClockCacheForTests();
    setBrokerClockFetcherForTests(async () => {
      throw new Error("broker clock timeout");
    });
    const unavailable = await getFreshBrokerClock({ force: true });
    assert.equal(unavailable.status, "unavailable");
    assert.equal(unavailable.isOpen, null);
    assert.ok(unavailable.error?.includes("broker clock timeout"));
    assert.equal(marketStatusLabel("unavailable"), "Market status unavailable");
    console.log("✓ clock failure is unavailable, not closed");

    setBrokerClockFetcherForTests(null);
    resetBrokerClockCacheForTests();
  }

  // 6) Genuine closed blocks eligibility
  {
    const closedOpp = decisionToOpportunity({
      symbol: "MSFT",
      action: "BUY",
      decisionLabel: "BUY",
      confidence: 0.9,
      reasons: ["Setup"],
      riskWarnings: [],
      riskStatus: "low",
      timestamp: new Date().toISOString(),
      paperOnly: true,
      readyForManualPaperTrade: true,
      tradeBlockReasons: [],
      dataQuality: {
        isMarketOpen: false,
        isQuoteStale: false,
        spreadPercent: 0.001,
        hasRecentBars: true,
        warningMessages: [],
      },
    } as never)!;
    assert.equal(closedOpp.marketStatus, "closed");
    const elig = evaluateAutoTradeEligibility({
      opportunity: closedOpp,
      envEnabled: true,
      executionEnabled: true,
      runtimeBlocked: false,
      killSwitch: false,
      panicStop: false,
      paperEndpointOk: true,
      dataQuality: {
        isMarketOpen: false,
        isQuoteStale: false,
        spreadPercent: 0.001,
        hasRecentBars: true,
        warningMessages: [],
      },
      riskStatus: "low",
      estimatedPrice: 100,
      notional: 200,
      dailyTradeCount: 0,
      dailyEstimatedPnL: 0,
      buyingPower: 50_000,
      hasPosition: false,
      positionQty: 0,
      buyCooldownActive: false,
      sellCooldownActive: false,
      symbolTradedThisScan: false,
      opportunityAlreadyProcessed: false,
      recentBuyWithoutSell: false,
      lastTradeWasLoss: false,
    });
    assert.equal(elig.eligible, false);
    assert.ok(elig.blockers.some((b) => b.code === "market_closed"));
    console.log("✓ genuine closed blocks order");
  }

  // 5b) Unavailable blocks with distinct code
  {
    const unavailOpp = decisionToOpportunity({
      symbol: "MSFT",
      action: "BUY",
      decisionLabel: "BUY",
      confidence: 0.9,
      reasons: ["Setup"],
      riskWarnings: [],
      riskStatus: "low",
      timestamp: new Date().toISOString(),
      paperOnly: true,
      readyForManualPaperTrade: true,
      tradeBlockReasons: [],
      dataQuality: {
        isMarketOpen: null,
        isQuoteStale: true,
        spreadPercent: 0.001,
        hasRecentBars: true,
        warningMessages: ["Market status unavailable"],
      },
    } as never)!;
    assert.equal(unavailOpp.marketStatus, "unavailable");
    assert.equal(
      primaryBlockReason(unavailOpp, { marketOpen: null }),
      "Market status unavailable",
    );
    const elig = evaluateAutoTradeEligibility({
      opportunity: unavailOpp,
      envEnabled: true,
      executionEnabled: true,
      runtimeBlocked: false,
      killSwitch: false,
      panicStop: false,
      paperEndpointOk: true,
      dataQuality: {
        isMarketOpen: null,
        isQuoteStale: true,
        spreadPercent: 0.001,
        hasRecentBars: true,
        warningMessages: [],
      },
      riskStatus: "low",
      estimatedPrice: 100,
      notional: 200,
      dailyTradeCount: 0,
      dailyEstimatedPnL: 0,
      buyingPower: 50_000,
      hasPosition: false,
      positionQty: 0,
      buyCooldownActive: false,
      sellCooldownActive: false,
      symbolTradedThisScan: false,
      opportunityAlreadyProcessed: false,
      recentBuyWithoutSell: false,
      lastTradeWasLoss: false,
    });
    assert.equal(elig.eligible, false);
    assert.ok(elig.blockers.some((b) => b.code === "market_status_unavailable"));
    assert.ok(!elig.blockers.some((b) => b.code === "market_closed"));
    console.log("✓ unavailable blocks with market_status_unavailable");
  }

  // 7) Opening delay label ≠ market closed
  {
    const openOpp = decisionToOpportunity({
      symbol: "AAPL",
      action: "BUY",
      decisionLabel: "BUY",
      confidence: 0.9,
      reasons: ["Strong setup"],
      riskWarnings: [],
      riskStatus: "low",
      timestamp: new Date().toISOString(),
      paperOnly: true,
      readyForManualPaperTrade: false,
      tradeBlockReasons: ["Opening delay has not passed"],
      dataQuality: {
        isMarketOpen: true,
        isQuoteStale: false,
        spreadPercent: 0.001,
        hasRecentBars: true,
        warningMessages: [],
      },
    } as never)!;
    assert.equal(openOpp.marketStatus, "open");
    assert.equal(
      primaryBlockReason(openOpp, { marketOpen: true }),
      "Opening delay",
    );
    assert.notEqual(
      primaryBlockReason(openOpp, { marketOpen: true }),
      "Market closed",
    );
    console.log("✓ opening delay is distinct from market closed");
  }

  // Free-text "market closed" must not override open clock
  {
    const texty = decisionToOpportunity({
      symbol: "MSFT",
      action: "BUY",
      decisionLabel: "BUY",
      confidence: 0.85,
      reasons: ["Interesting setup but market closed"],
      riskWarnings: [],
      riskStatus: "low",
      timestamp: new Date().toISOString(),
      paperOnly: true,
      readyForManualPaperTrade: true,
      tradeBlockReasons: [],
      dataQuality: {
        isMarketOpen: true,
        isQuoteStale: false,
        spreadPercent: 0.001,
        hasRecentBars: true,
        warningMessages: [],
      },
      explanation: {
        technical: "ok",
        news: "ok",
        market: "Interesting setup but market closed",
        risk: "ok",
        summary: "Interesting setup but market closed",
      },
    } as never)!;
    assert.equal(texty.marketStatus, "open");
    assert.equal(texty.readyForPaperPreview, true);
    assert.equal(monitorTradeStatus(texty, { marketOpen: true }), "Trade eligible");
    assert.notEqual(
      primaryBlockReason(texty, { marketOpen: true }),
      "Market closed",
    );
    console.log("✓ free-text market closed does not override open broker clock");
  }

  // 8) Eligible open path
  {
    const openOpp = decisionToOpportunity({
      symbol: "MSFT",
      action: "BUY",
      decisionLabel: "BUY",
      confidence: 0.9,
      reasons: ["Eligible"],
      riskWarnings: [],
      riskStatus: "low",
      timestamp: new Date().toISOString(),
      paperOnly: true,
      readyForManualPaperTrade: true,
      tradeBlockReasons: [],
      dataQuality: {
        isMarketOpen: true,
        isQuoteStale: false,
        spreadPercent: 0.001,
        hasRecentBars: true,
        warningMessages: [],
      },
    } as never)!;
    const elig = evaluateAutoTradeEligibility({
      opportunity: openOpp,
      envEnabled: true,
      executionEnabled: true,
      runtimeBlocked: false,
      killSwitch: false,
      panicStop: false,
      paperEndpointOk: true,
      dataQuality: {
        isMarketOpen: true,
        isQuoteStale: false,
        spreadPercent: 0.001,
        hasRecentBars: true,
        warningMessages: [],
      },
      riskStatus: "low",
      estimatedPrice: 100,
      notional: 5,
      dailyTradeCount: 0,
      dailyEstimatedPnL: 0,
      buyingPower: 50_000,
      hasPosition: false,
      positionQty: 0,
      buyCooldownActive: false,
      sellCooldownActive: false,
      symbolTradedThisScan: false,
      opportunityAlreadyProcessed: false,
      recentBuyWithoutSell: false,
      lastTradeWasLoss: false,
    });
    if (!elig.eligible) {
      console.error("unexpected blockers:", elig.blockers);
    }
    assert.equal(elig.eligible, true);
    console.log("✓ open market + rules pass → eligible");
  }

  // 9) UI mapper: open / closed / unavailable
  {
    const openItem = buildSystemStatusItems({
      marketOpen: true,
      safetyOk: true,
      orderExecutionEnabled: true,
    } as never).find((i) => i.key === "market");
    assert.equal(openItem?.state, "Open");

    const closedItem = buildSystemStatusItems({
      marketOpen: false,
      safetyOk: true,
      orderExecutionEnabled: true,
    } as never).find((i) => i.key === "market");
    assert.equal(closedItem?.state, "Closed");

    const unItem = buildSystemStatusItems({
      marketOpen: null,
      safetyOk: true,
      orderExecutionEnabled: true,
    } as never).find((i) => i.key === "market");
    assert.equal(unItem?.state, "Unavailable");
    console.log("✓ status mapper separates open / closed / unavailable");
  }

  // 10) DST boundary — Eastern wall time via IANA
  {
    const spring = easternWallTime(DST_SPRING_UTC);
    const fall = easternWallTime(DST_FALL_UTC);
    // 12:00 UTC on spring day (EDT = UTC-4) → 08:00 ET
    assert.equal(spring.hour, 8);
    // 12:00 UTC on fall day (EST = UTC-5) → 07:00 ET
    assert.equal(fall.hour, 7);
    console.log("✓ DST boundary uses America/New_York (no fixed UTC-4/5)");
  }

  // 11) Weekend closed (local estimate)
  {
    assert.equal(localRegularSessionOpen(SATURDAY_NOON_ET_UTC), false);
    console.log("✓ weekend local session closed");
  }

  // 12) Holiday — Alpaca clock is authority (simulate closed holiday Monday)
  {
    resetBrokerClockCacheForTests();
    setBrokerClockFetcherForTests(async () => ({
      isOpen: false,
      timestamp: "2026-01-01T17:00:00Z",
      nextOpen: "2026-01-02T14:30:00Z",
      nextClose: "2026-01-02T21:00:00Z",
      paperOnly: true as const,
    }));
    const holiday = await getFreshBrokerClock({ force: true });
    assert.equal(holiday.status, "closed");
    setBrokerClockFetcherForTests(null);
    resetBrokerClockCacheForTests();
    console.log("✓ holiday closed follows Alpaca clock");
  }

  // 13) Early close — nextClose from broker clock preserved
  {
    resetBrokerClockCacheForTests();
    setBrokerClockFetcherForTests(async () => ({
      isOpen: true,
      timestamp: "2026-07-03T17:00:00Z",
      nextOpen: "2026-07-07T13:30:00Z",
      nextClose: "2026-07-03T17:00:00Z", // 1:00 PM ET early close
      paperOnly: true as const,
    }));
    const early = await getFreshBrokerClock({ force: true });
    assert.equal(early.status, "open");
    assert.equal(early.nextClose, "2026-07-03T17:00:00Z");
    setBrokerClockFetcherForTests(null);
    resetBrokerClockCacheForTests();
    console.log("✓ early-close nextClose preserved from broker clock");
  }

  // Pause/skip must not hardcode marketOpen: false
  {
    const service = fs.readFileSync("src/lib/monitor/service.ts", "utf8");
    const scanner = fs.readFileSync("src/lib/monitor/scanner.ts", "utf8");
    assert.ok(service.includes("marketOpen: null"));
    assert.ok(service.includes("result.marketOpen != null"));
    assert.ok(scanner.includes("getFreshBrokerClock"));
    assert.ok(!/buildPausedSkipResult[\s\S]*marketOpen:\s*false/.test(service));
    console.log("✓ pause/skip paths no longer force marketOpen: false");
  }

  console.log("verify:market-clock OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
