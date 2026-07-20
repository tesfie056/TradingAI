/**
 * Version 1 strategy live inspection — Alpaca paper/IEX read-only.
 * Never submits, cancels, or modifies orders or positions.
 *
 * Run: npm run inspect:v1-strategy
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && process.env[m[1].trim()] === undefined) {
    process.env[m[1].trim()] = m[2].trim();
  }
}

async function main() {
  const { assertPaperTradingOnly } = await import("../src/lib/alpaca/safety");
  const { PAPER_TRADING_BASE_URL } = await import("../src/lib/config");
  assertPaperTradingOnly(
    process.env.ALPACA_BASE_URL?.trim() || PAPER_TRADING_BASE_URL,
  );

  const { V1_DEFAULT_WATCHLIST } = await import(
    "../src/lib/universe/v1-default-watchlist"
  );
  const { resolveEligibleUniverse } = await import(
    "../src/lib/universe/service"
  );
  const {
    getMarketClock,
    getLatestQuotes,
    getPositions,
    getOpenOrders,
  } = await import("../src/lib/alpaca/client");
  const { fetchMultiTimeframeBars } = await import(
    "../src/lib/stocks/fetch-context"
  );
  const { assessDataQuality } = await import("../src/lib/market/data-quality");
  const { getRiskTradingConfig } = await import("../src/lib/config/risk-config");
  const {
    evaluateV1SimpleLong,
    saveV1StrategyLatest,
    appendV1StrategyDecisions,
    minutesSinceRegularOpen,
    minutesUntilRegularClose,
    partitionV1Decisions,
    rankV1BuyCandidates,
    V1_STRATEGY_ID,
    V1_STRATEGY_VERSION,
  } = await import("../src/lib/strategy/v1-simple-long");
  const { readReconcileState } = await import("../src/lib/trading/reconcile");

  console.log("inspect:v1-strategy — paper only, planning only, read-only");
  console.log(`Strategy: ${V1_STRATEGY_ID} ${V1_STRATEGY_VERSION}`);

  const clock = await getMarketClock();
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(clock.timestamp));
  const weekday = etParts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(etParts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(etParts.find((p) => p.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  let session: string;
  if (clock.isOpen) {
    session = "regular market hours";
  } else if (isWeekend) {
    session = "weekend or market holiday";
  } else if (mins < 9 * 60 + 30) {
    session = "premarket";
  } else if (mins >= 16 * 60) {
    session = "after-hours";
  } else {
    session = "weekend or market holiday";
  }
  console.log(`Market: ${clock.isOpen ? "OPEN" : "CLOSED"} · ${clock.timestamp}`);
  console.log(`Session context: ${session}`);
  if (!clock.isOpen) {
    console.log(
      "WARNING: After-hours / closed-session spreads and incomplete bars are not equivalent to regular-market conditions.",
    );
  }

  const universe = await resolveEligibleUniverse({
    symbols: [...V1_DEFAULT_WATCHLIST],
  });
  const symbols = universe.eligibleSymbols;
  console.log(
    `Universe eligible: ${symbols.length}/${universe.watchlist.length}`,
  );
  if (symbols.length === 0) {
    console.log("BLOCKED — zero eligible symbols");
    process.exit(0);
  }

  const { readRiskRuntime } = await import("../src/lib/risk/runtime");
  const [quotes, multiBars, positions, openOrders, reconcile, riskRuntime] =
    await Promise.all([
      getLatestQuotes(symbols),
      fetchMultiTimeframeBars(symbols),
      getPositions().catch(() => []),
      getOpenOrders(100).catch(() => []),
      readReconcileState().catch(() => null),
      readRiskRuntime().catch(() => null),
    ]);
  const reconciliationComplete =
    riskRuntime?.reconciliationComplete === true ||
    (reconcile != null &&
      reconcile.completedAt != null &&
      !reconcile.inProgress &&
      reconcile.error == null);

  // Confirm we did not touch the AAPL short — read only
  const aapl = positions.find((p) => p.symbol.toUpperCase() === "AAPL");
  if (aapl) {
    console.log(
      `Note: existing AAPL position qty=${aapl.qty} side=${aapl.side} left untouched.`,
    );
  }

  const openSyms = new Set(
    positions.filter((p) => Number(p.qty) !== 0).map((p) => p.symbol.toUpperCase()),
  );
  const pendingEntry = new Set(
    openOrders
      .filter((o) => o.side === "buy")
      .map((o) => o.symbol.toUpperCase()),
  );
  const pendingExit = new Set(
    openOrders
      .filter((o) => o.side === "sell")
      .map((o) => o.symbol.toUpperCase()),
  );

  const riskCfg = getRiskTradingConfig();
  const nowMs = Date.now();
  const quoteMap = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  const scanId = `inspect_${Date.now().toString(36)}`;

  const results = symbols.map((sym) => {
    const q = quoteMap.get(sym);
    const bars5 = multiBars.bars5Min?.[sym] ?? [];
    const dq = assessDataQuality({
      isMarketOpen: clock.isOpen,
      quote: q,
      bars: bars5,
      nowMs,
    });
    return evaluateV1SimpleLong({
      symbol: sym,
      quote: q ?? null,
      bars5Min: bars5,
      bars15Min: multiBars.bars15Min?.[sym] ?? [],
      bars1Min: multiBars.bars1Min?.[sym],
      dataQuality: dq,
      context: {
        isMarketOpen: clock.isOpen,
        minutesSinceOpen: clock.isOpen ? minutesSinceRegularOpen(nowMs) : null,
        minutesToClose: clock.isOpen ? minutesUntilRegularClose(nowMs) : null,
        hasOpenPosition: openSyms.has(sym),
        hasPendingEntry: pendingEntry.has(sym),
        hasPendingExit: pendingExit.has(sym),
        reconciliationComplete,
        universeEligible: true,
        openEntryDelayMinutes: riskCfg.openEntryDelayMinutes,
        eodEntryCutoffMinutes: riskCfg.eodEntryCutoffMinutes,
        minPrice: riskCfg.minPrice,
        maxPrice: riskCfg.maxPrice,
        maxSpreadPercent: riskCfg.maxSpreadPercent,
        stopLossPct: riskCfg.defaultStopLossPct,
        takeProfitPct: riskCfg.defaultTakeProfitPct,
        nowMs,
        scanId,
      },
    });
  });

  const parts = partitionV1Decisions(results);
  const ranked = rankV1BuyCandidates(results);

  console.log("\n=== Decision counts ===");
  console.log(`BUY:   ${parts.buy.length}`);
  console.log(`WATCH: ${parts.watch.length}`);
  console.log(`SKIP:  ${parts.skip.length}`);
  console.log(`HOLD:  ${parts.hold.length}`);

  console.log("\n=== Per symbol ===");
  for (const r of results) {
    console.log(
      `  ${r.symbol.padEnd(5)} ${r.decision.padEnd(5)} score=${(r.score * 100).toFixed(0)}%  ${r.primaryReasons[0] ?? ""}`,
    );
    console.log(
      `         indicators: 5MinTrend=${r.indicators.trend5MinPct != null ? `${(r.indicators.trend5MinPct * 100).toFixed(2)}%` : "n/a"} range=${r.indicators.rangePct != null ? `${(r.indicators.rangePct * 100).toFixed(2)}%` : "n/a"} volRatio=${r.indicators.volumeRatio ?? "n/a"} MA=${r.indicators.entryFastAboveSlow ? "aligned" : "not aligned"}`,
    );
    const failed = r.conditions.filter((c) => !c.passed);
    if (failed.length) {
      console.log(
        `         failed: ${failed.map((c) => c.id).join(", ")}`,
      );
    }
    if (r.decision === "BUY" || r.decision === "WATCH") {
      console.log(
        `         plan entry $${r.suggestedEntry} SL $${r.suggestedStopLoss} TP $${r.suggestedTakeProfit} R:R ${r.rewardToRisk} (not submitted)`,
      );
    }
  }

  if (ranked.length) {
    console.log("\n=== Ranked BUY candidates (not submitted) ===");
    for (const row of ranked) {
      console.log(`  #${row.rank} ${row.result.symbol} score=${row.result.score}`);
    }
  }

  await saveV1StrategyLatest({
    scanId,
    evaluatedAt: new Date().toISOString(),
    marketOpen: clock.isOpen,
    results,
  });
  await appendV1StrategyDecisions(
    results.map((r) => ({
      ...r,
      scanId,
      dataTimestamp: quoteMap.get(r.symbol)?.timestamp ?? null,
    })),
  );

  const report = {
    paperOnly: true as const,
    planningOnly: true as const,
    mutatedOrdersOrPositions: false as const,
    liveTradingAllowed: false as const,
    sessionContext: session,
    strategyId: V1_STRATEGY_ID,
    strategyVersion: V1_STRATEGY_VERSION,
    evaluatedAt: new Date().toISOString(),
    marketOpen: clock.isOpen,
    counts: {
      buy: parts.buy.length,
      watch: parts.watch.length,
      skip: parts.skip.length,
      hold: parts.hold.length,
    },
    rankedBuySymbols: ranked.map((r) => r.result.symbol),
    results,
  };

  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const outPath = path.join(dir, "v1-strategy-report.json");
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nSaved: ${outPath}`);
  console.log("No orders submitted. No positions modified.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
