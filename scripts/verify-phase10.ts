/**
 * Phase 10 — faster monitoring verification.
 * Run: npm run verify:phase10
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

async function main() {
  console.log("verify:phase10 starting…");

  const {
    getMonitorIntervalOpenMs,
    getMonitorIntervalClosedMs,
    isMonitorWorkerAutoStart,
  } = await import("../src/lib/monitor/rate-limit");

  const openMs = getMonitorIntervalOpenMs();
  const closedMs = getMonitorIntervalClosedMs();
  assert.ok(openMs >= 60_000 && openMs <= 180_000);
  assert.ok(closedMs >= openMs);
  console.log(`✓ market-aware intervals (open ${openMs}ms, closed ${closedMs}ms)`);

  const quoteCache = path.join(process.cwd(), "src", "lib", "cache", "quote-cache.ts");
  const newsCache = path.join(process.cwd(), "src", "lib", "cache", "news-cache.ts");
  assert.ok(fs.existsSync(quoteCache));
  assert.ok(fs.existsSync(newsCache));
  console.log("✓ quote and news cache modules");

  const worker = path.join(process.cwd(), "src", "lib", "monitor", "worker.ts");
  const instrumentation = path.join(process.cwd(), "src", "instrumentation.ts");
  assert.ok(fs.existsSync(worker));
  assert.ok(fs.existsSync(instrumentation));
  console.log("✓ background worker + instrumentation");

  const streamRoute = path.join(
    process.cwd(),
    "src",
    "app",
    "api",
    "monitor",
    "stream",
    "route.ts",
  );
  assert.ok(fs.existsSync(streamRoute));
  console.log("✓ SSE monitor stream route");

  const { getMonitorStatus } = await import("../src/lib/monitor/service");
  const status = await getMonitorStatus();
  assert.ok(status.heartbeatAt);
  console.log("✓ monitor status heartbeat field");

  const scannerSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "monitor", "scanner.ts"),
    "utf8",
  );
  assert.ok(scannerSrc.includes("getCachedLatestQuotes"));
  assert.ok(scannerSrc.includes("getCachedWatchlistNews"));
  console.log("✓ scanner uses cached quotes and news");

  assert.equal(typeof isMonitorWorkerAutoStart(), "boolean");
  console.log("✓ worker auto-start config readable");

  console.log("verify:phase10 passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
