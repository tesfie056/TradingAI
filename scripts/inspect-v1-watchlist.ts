/**
 * Version 1 watchlist inspection — live Alpaca paper market data.
 * Validates candidates through the same universe pipeline used by auto-trading.
 * Never places, cancels, or modifies orders or positions.
 *
 * Run: npm run inspect:v1-watchlist
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

// Load .env.local without printing secrets
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
  const { getMarketClock } = await import("../src/lib/alpaca/client");

  const symbols = [...V1_DEFAULT_WATCHLIST];
  console.log("inspect:v1-watchlist — paper only, read-only");
  console.log(`Candidates (${symbols.length}): ${symbols.join(", ")}`);

  let clockNote = "unknown";
  try {
    const clock = await getMarketClock();
    clockNote = clock.isOpen
      ? "regular market hours (open)"
      : "market closed / outside regular session";
    console.log(
      `Market: ${clock.isOpen ? "OPEN" : "CLOSED"} · ${clock.timestamp}`,
    );
    if (!clock.isOpen) {
      console.log(
        "WARNING: After-hours spreads are not equivalent to regular-session spreads.",
      );
    }
  } catch (err) {
    console.log(
      `Market clock unavailable: ${err instanceof Error ? err.message : err}`,
    );
  }

  const result = await resolveEligibleUniverse({ symbols });

  console.log("\n=== Eligibility report ===");
  console.log(`Evaluated at: ${result.evaluatedAt}`);
  console.log(`Configured: ${result.breakdown.watchlistSize}`);
  console.log(`Eligible: ${result.breakdown.eligibleCount}`);
  console.log(`Ineligible: ${result.breakdown.ineligibleCount}`);
  console.log(`Data freshness: ${result.dataFreshness}`);
  console.log(
    `Filters: $${result.filterConfig.minPrice}–$${result.filterConfig.maxPrice}, ADV≥${result.filterConfig.minAvgDailyVolume}, spread≤${result.filterConfig.maxSpreadPercent}%`,
  );

  console.log("\nSymbol details:");
  for (const row of result.scanned) {
    const status = row.eligible ? "ELIGIBLE" : "REJECTED";
    const price = row.price != null ? `$${row.price.toFixed(2)}` : "n/a";
    const adv =
      row.avgDailyVolume != null
        ? Math.floor(row.avgDailyVolume).toLocaleString()
        : "n/a";
    const spread =
      row.spreadPercent != null
        ? `${(row.spreadPercent * 100).toFixed(3)}%`
        : "n/a";
    console.log(
      `  ${row.symbol.padEnd(5)} ${status.padEnd(9)} ${price.padStart(10)}  ADV ${adv.padStart(12)}  spread ${spread.padStart(8)}  frac=${row.fractionable}  tradable=${row.tradable}`,
    );
    if (!row.eligible) {
      for (const reason of row.userReasons) {
        console.log(`         → ${reason}`);
      }
    }
  }

  if (result.warnings.length) {
    console.log("\nWarnings:");
    for (const w of result.warnings) console.log(`  - ${w}`);
  }

  const report = {
    paperOnly: true as const,
    liveTradingAllowed: false as const,
    mutatedOrdersOrPositions: false as const,
    sessionContext: clockNote,
    evaluatedAt: result.evaluatedAt,
    marketOpen: result.marketOpen,
    dataFreshness: result.dataFreshness,
    filterConfig: result.filterConfig,
    configuredSymbols: result.watchlist,
    eligibleSymbols: result.eligibleSymbols,
    ineligibleSymbols: result.breakdown.ineligibleSymbols,
    eligibleCount: result.breakdown.eligibleCount,
    ineligibleCount: result.breakdown.ineligibleCount,
    scanned: result.scanned,
    warnings: result.warnings,
  };

  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const outPath = path.join(dir, "v1-watchlist-report.json");
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nSaved: ${outPath}`);
  console.log(
    result.breakdown.eligibleCount > 0
      ? `PASS — ${result.breakdown.eligibleCount} eligible Version 1 symbols`
      : "BLOCKED — zero eligible symbols (auto-trading must stay blocked)",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
