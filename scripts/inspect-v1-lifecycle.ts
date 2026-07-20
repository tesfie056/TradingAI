/**
 * Version 1 lifecycle inspection — Alpaca paper read-only + dry-run reconcile.
 * Never submits, cancels, or modifies orders or positions.
 *
 * Run: npm run inspect:v1-lifecycle
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

  const {
    getMarketClock,
    getPositions,
    getOpenOrders,
    getOrders,
  } = await import("../src/lib/alpaca/client");
  const { reconcileV1Lifecycle } = await import(
    "../src/lib/trading/v1-lifecycle"
  );

  console.log("inspect:v1-lifecycle — paper only, dry-run, no mutations");

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
  if (clock.isOpen) session = "regular market hours";
  else if (isWeekend) session = "weekend or market holiday";
  else if (mins < 9 * 60 + 30) session = "premarket";
  else if (mins >= 16 * 60) session = "after-hours";
  else session = "weekend or market holiday";

  console.log(`Market: ${clock.isOpen ? "OPEN" : "CLOSED"} · ${clock.timestamp}`);
  console.log(`Session context: ${session}`);

  const [positions, openOrders, recentOrders] = await Promise.all([
    getPositions(),
    getOpenOrders(100),
    getOrders(100),
  ]);

  const report = await reconcileV1Lifecycle({
    positions,
    openOrders,
    recentOrders,
    marketOpen: clock.isOpen,
    sessionContext: session,
    dryRun: true,
  });

  console.log("\n=== Position classification ===");
  if (report.classifications.length === 0) {
    console.log("  (no open positions)");
  }
  for (const c of report.classifications) {
    console.log(
      `  ${c.symbol.padEnd(5)} qty=${c.qty}  ${c.ownership.padEnd(10)}  ${c.reason}`,
    );
  }

  console.log("\n=== Version 1 active trades (local) ===");
  if (report.activeTrades.length === 0) {
    console.log("  (none)");
  }
  for (const t of report.activeTrades) {
    console.log(
      `  ${t.symbol} ${t.lifecycleState} protection=${t.protectionStatus} rem=${t.remainingQty}`,
    );
  }

  console.log("\n=== Protection / AAPL ===");
  console.log(
    `  Missing protection trade IDs: ${report.missingProtectionTradeIds.join(", ") || "(none)"}`,
  );
  console.log(
    `  AAPL short blocks V1 AAPL BUY: ${report.aaplShortBlocksEntries ? "YES" : "no"}`,
  );
  console.log(
    `  Pause Auto Trading recommended: ${report.pauseAutoTradingRecommended ? "YES" : "no"}`,
  );

  console.log("\n=== Warnings ===");
  for (const w of report.warnings) {
    console.log(`  [${w.level}] ${w.symbol ?? ""} ${w.message}`);
  }

  console.log("\nPlanned mutations: NONE (dry-run)");
  console.log("Orders submitted: 0");
  console.log("Orders canceled: 0");
  console.log("Positions modified: 0");

  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const outPath = path.join(dir, "v1-lifecycle-report.json");
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        ...report,
        plannedMutations: [],
        liveTradingAllowed: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\nSaved: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
