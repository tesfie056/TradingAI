/**
 * Version 1 daily status inspection — read-only / dry-run rebuild.
 * Never submits, cancels, or modifies orders or positions.
 *
 * Run: npm run inspect:v1-daily-status
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

  const { getMarketClock, getPositions } = await import(
    "../src/lib/alpaca/client"
  );
  const {
    rebuildV1DailySession,
    buildV1DailyReport,
    getV1DailyConfig,
    getV1DailyConfigWarnings,
  } = await import("../src/lib/trading/v1-daily");
  const { classifyPosition, listActiveV1Trades } = await import(
    "../src/lib/trading/v1-lifecycle"
  );
  const { todayMarketDayKey } = await import("../src/lib/market/time");

  console.log("inspect:v1-daily-status — paper only, dry-run rebuild, no mutations");

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
  let sessionCtx: string;
  if (clock.isOpen) sessionCtx = "regular market hours";
  else if (isWeekend) sessionCtx = "weekend or market holiday";
  else if (mins < 9 * 60 + 30) sessionCtx = "premarket";
  else if (mins >= 16 * 60) sessionCtx = "after-hours";
  else sessionCtx = "weekend or market holiday";

  const tradingDate = todayMarketDayKey();
  console.log(`Market: ${clock.isOpen ? "OPEN" : "CLOSED"} · ${clock.timestamp}`);
  console.log(`Session context: ${sessionCtx}`);
  console.log(`Trading date (ET): ${tradingDate}`);

  const positions = await getPositions().catch(() => []);
  const active = await listActiveV1Trades();
  const classifications = positions
    .filter((p) => Number(p.qty) !== 0)
    .map((position) =>
      classifyPosition({
        position,
        v1Trades: active,
        openOrders: [],
      }),
    );
  const aapl = classifications.find((c) => c.isLegacyAaplShort);

  const session = await rebuildV1DailySession(tradingDate, {
    marketOpen: clock.isOpen,
    failureContext: {
      marketOpen: clock.isOpen,
      executionEnabled: false,
      autoTradingEnabled: false,
    },
  });
  const report = buildV1DailyReport(session);
  const cfg = getV1DailyConfig();
  const warnings = getV1DailyConfigWarnings(cfg);

  console.log("\n=== Daily target ===");
  console.log(`  Target: ${session.dailyCompletedTradeTarget}`);
  console.log(`  Completed: ${session.completedTradesToday}`);
  console.log(`  Remaining: ${session.remainingToTarget}`);
  console.log(`  Wins / losses / even: ${session.wins} / ${session.losses} / ${session.breakeven}`);
  console.log(`  Realized net P/L: $${session.netRealizedPnL.toFixed(2)}`);
  console.log(`  Open managed: ${session.openV1Trades}`);
  console.log(`  Pending entry / exit: ${session.pendingEntries} / ${session.pendingExits}`);
  console.log(`  Target reached: ${session.targetReached ? "YES" : "no"}`);
  console.log(`  Session status: ${session.status}`);

  console.log("\n=== Configuration ===");
  console.log(`  maxTradesPerDay (entry submissions): ${cfg.maxTradesPerDay}`);
  for (const w of warnings) console.log(`  WARNING: ${w.message}`);

  console.log("\n=== Block / incomplete reasons ===");
  for (const r of session.failureReasons) {
    console.log(`  [${r.code}] ${r.message}`);
  }

  console.log("\n=== AAPL short ===");
  if (aapl) {
    console.log(
      `  Present qty=${aapl.qty} ownership=${aapl.ownership} — EXCLUDED from daily completed count`,
    );
  } else {
    console.log("  Not present in broker positions");
  }
  console.log("  Counted trade IDs never include legacy AAPL short");

  console.log("\nPlanned mutations: NONE");
  console.log("Orders submitted: 0 · canceled: 0 · positions modified: 0");

  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const outPath = path.join(dir, "v1-daily-status-report.json");
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        paperOnly: true,
        mutatedOrdersOrPositions: false,
        sessionContext: sessionCtx,
        tradingDate,
        config: cfg,
        warnings,
        session,
        report,
        aaplShort: aapl ?? null,
        aaplShortExcluded: true,
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
