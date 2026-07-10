/**
 * Phase 7 verification:
 * - monitor can run one scan (offline/unit path)
 * - monitor stores opportunities
 * - monitor does not place orders
 * - live trading blocked
 * - secrets not exposed in logs
 * - stocks only / paper only
 *
 * Run: npm run verify:phase7
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { placePaperOrder } from "../src/lib/alpaca/client";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import { isPaperOrderExecutionEnabled } from "../src/lib/config";
import {
  decisionToOpportunity,
  decisionsToOpportunities,
  suggestMonitorAction,
} from "../src/lib/monitor/opportunity";
import { buildScanNotifications } from "../src/lib/monitor/notifications";
import type { AiDecision } from "../src/lib/alpaca/types";
import type { MonitorOpportunity } from "../src/lib/monitor/types";

// Inline sanitize check without exporting from logs (test the pattern)
function redactLikeLogs(message: string): string {
  return message
    .replace(/PK[A-Z0-9]{10,}/gi, "[REDACTED_KEY]")
    .replace(/sk[_-][A-Za-z0-9]{10,}/gi, "[REDACTED_SECRET]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

function sampleDecision(
  overrides: Partial<AiDecision> & { symbol: string },
): AiDecision {
  return {
    symbol: overrides.symbol,
    action: overrides.action ?? "HOLD",
    confidence: overrides.confidence ?? 0.6,
    reasons: overrides.reasons ?? ["test"],
    riskWarnings: overrides.riskWarnings ?? [],
    riskStatus: overrides.riskStatus ?? "low",
    riskLevel: overrides.riskLevel ?? "low",
    timestamp: new Date().toISOString(),
    paperOnly: true,
    assetClass: "us_equity",
    dataQuality: overrides.dataQuality ?? {
      isMarketOpen: false,
      isQuoteStale: true,
      spreadPercent: 0.02,
      hasRecentBars: true,
      warningMessages: ["Market closed", "Quote stale"],
    },
    newsContext: overrides.newsContext ?? {
      overallSentiment: null,
      highestImportance: null,
      sentimentScore: 0,
      explanation: "Quiet tape.",
      headlines: [],
    },
    scores: overrides.scores ?? {
      technicalScore: 0.72,
      newsScore: 0.55,
      marketScore: 0.5,
      riskScore: 0.3,
      finalScore: 0.62,
      confidence: 0.6,
    },
    explanation: overrides.explanation ?? {
      technical: "Bullish lean",
      news: "Neutral",
      market: "Unclear",
      risk: "Elevated while closed",
      summary: "Interesting setup but market closed",
    },
    readyForManualPaperTrade: overrides.readyForManualPaperTrade ?? false,
    tradeBlockReasons: overrides.tradeBlockReasons ?? [
      "Market is closed.",
      "Quote is stale.",
    ],
    metrics: overrides.metrics,
    marketCondition: overrides.marketCondition,
  };
}

async function main() {
  console.log("verify:phase7 starting…");

  assert.equal(isPaperOrderExecutionEnabled(), false);
  console.log("✓ paper order execution disabled by default");

  assert.throws(
    () => assertPaperTradingOnly("https://api.alpaca.markets"),
    PaperTradingSafetyError,
  );
  console.log("✓ live trading endpoint blocked");

  await assert.rejects(
    () =>
      placePaperOrder({
        symbol: "AAPL",
        qty: 1,
        side: "buy",
      }),
    /disabled|execution/i,
  );
  console.log("✓ placePaperOrder blocked (monitor must not trade)");

  // Source safety: monitor modules must not call submit-paper or placePaperOrder
  const monitorDir = path.join(process.cwd(), "src", "lib", "monitor");
  const monitorFiles = fs.readdirSync(monitorDir);
  for (const file of monitorFiles) {
    if (!file.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(monitorDir, file), "utf8");
    // Ignore comments; flag real call/import usage only.
    const code = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    assert.equal(
      /\bplacePaperOrder\b|\bsubmitManualPaperOrder\b|\/api\/trades\/submit-paper/.test(
        code,
      ),
      false,
      `${file} must not place orders`,
    );
  }
  console.log("✓ monitor source does not place orders");

  const apiMonitor = path.join(process.cwd(), "src", "app", "api", "monitor");
  assert.ok(fs.existsSync(apiMonitor), "monitor API routes exist");
  console.log("✓ monitor API routes present");

  // Opportunity scanner (offline)
  const closedInteresting = sampleDecision({
    symbol: "AAPL",
    action: "HOLD",
    scores: {
      technicalScore: 0.72,
      newsScore: 0.55,
      marketScore: 0.5,
      riskScore: 0.3,
      finalScore: 0.62,
      confidence: 0.6,
    },
  });
  assert.equal(suggestMonitorAction(closedInteresting), "WATCH");
  const opp = decisionToOpportunity(closedInteresting, { ollamaUsed: false });
  assert.ok(opp);
  assert.equal(opp!.paperOnly, true);
  assert.equal(opp!.action, "WATCH");
  assert.ok(opp!.blockedReasons.some((r) => /closed/i.test(r)));
  assert.equal(opp!.readyForPaperPreview, false);
  console.log("✓ opportunity scanner creates WATCH when blocked but interesting");

  const readyBuy = sampleDecision({
    symbol: "MSFT",
    action: "BUY",
    readyForManualPaperTrade: true,
    tradeBlockReasons: [],
    dataQuality: {
      isMarketOpen: true,
      isQuoteStale: false,
      spreadPercent: 0.001,
      hasRecentBars: true,
      warningMessages: [],
    },
    scores: {
      technicalScore: 0.8,
      newsScore: 0.6,
      marketScore: 0.65,
      riskScore: 0.8,
      finalScore: 0.7,
      confidence: 0.75,
    },
  });
  assert.equal(suggestMonitorAction(readyBuy), "BUY");
  const buyOpp = decisionToOpportunity(readyBuy)!;
  assert.equal(buyOpp.readyForPaperPreview, true);
  console.log("✓ BUY opportunity ready for paper preview flag");

  const batch = decisionsToOpportunities([closedInteresting, readyBuy]);
  assert.ok(batch.length >= 2);
  assert.ok(batch.every((o) => o.paperOnly === true));
  console.log("✓ opportunities batch stored shape ok");

  // Persist to local queue (uses data/)
  const { appendOpportunities, readOpportunities, readActiveOpportunities } =
    await import("../src/lib/monitor/queue");
  const { appendMonitorLog, readMonitorLogs } = await import(
    "../src/lib/monitor/logs"
  );
  const { resetMonitorRateLimitForTests } = await import(
    "../src/lib/monitor/rate-limit"
  );
  resetMonitorRateLimitForTests();

  await appendOpportunities(batch as MonitorOpportunity[]);
  const stored = await readOpportunities(20);
  assert.ok(stored.some((o) => o.symbol === "AAPL" || o.symbol === "MSFT"));
  const active = await readActiveOpportunities();
  assert.ok(active.length >= 1);
  console.log("✓ monitor stores opportunities locally");

  await appendMonitorLog({
    event: "scan_completed",
    message: "verify scan completed — key PKTESTSECRET1234567890 should redact",
  });
  const logs = await readMonitorLogs(5);
  assert.ok(logs.some((l) => l.event === "scan_completed"));
  const leaked = logs.some(
    (l) => /PKTESTSECRET|ALPACA_SECRET|sk_live/i.test(l.message),
  );
  assert.equal(leaked, false);
  assert.match(
    redactLikeLogs("Bearer abc.def.ghi PKABCDEFGHIJKLMNOP"),
    /REDACTED/,
  );
  console.log("✓ secrets not exposed in monitor logs");

  const notes = buildScanNotifications(batch);
  assert.ok(notes.some((n) => n.kind === "blocked_market_closed"));
  assert.ok(notes.some((n) => n.kind === "ready_for_preview"));
  assert.ok(notes.every((n) => n.paperOnly === true));
  console.log("✓ dashboard notifications kinds present");

  const { getMonitorStatus, resetMonitorServiceForTests } = await import(
    "../src/lib/monitor/service"
  );
  resetMonitorServiceForTests();
  const status = await getMonitorStatus();
  assert.equal(status.paperOnly, true);
  assert.equal(status.canPlaceOrders, false);
  assert.equal(status.automaticTradingAllowed, false);
  assert.equal(status.status, "stopped");
  console.log("✓ monitor status is paper-only / no auto trading");

  const scannerSrc = fs.readFileSync(
    path.join(monitorDir, "scanner.ts"),
    "utf8",
  );
  assert.equal(/\/api\/trades\/submit-paper/.test(scannerSrc), false);
  console.log("✓ scanner cannot call submit-paper route");

  console.log("verify:phase7 passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
