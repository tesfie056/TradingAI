/**
 * Full auto-trade risk suite (Phases A–E unit coverage).
 * Paper only — no live trading.
 * Run: npm run verify:auto-trade-risk
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  assertPaperTradingOnly,
  PaperTradingSafetyError,
} from "../src/lib/alpaca/safety";
import { buildRankedCandidates } from "../src/lib/trading/build-candidates";
import {
  appendDecisionLog,
  readDecisionLog,
} from "../src/lib/trading/decision-log";

async function main() {
  console.log("verify:auto-trade-risk starting…");

  execSync("npx --yes tsx scripts/verify-universe.ts", { stdio: "inherit" });
  execSync("npx --yes tsx scripts/verify-risk-engine.ts", { stdio: "inherit" });
  execSync("npx --yes tsx scripts/verify-brackets.ts", { stdio: "inherit" });

  const snap = buildRankedCandidates({
    scannedAt: new Date().toISOString(),
    decisions: [
      {
        symbol: "AAPL",
        action: "BUY",
        decisionLabel: "BUY",
        confidence: 0.85,
        reasons: ["test"],
        riskWarnings: [],
        riskStatus: "low",
        timestamp: new Date().toISOString(),
        paperOnly: true,
        readyForManualPaperTrade: true,
        metrics: {
          last: 25,
          mid: 25,
          spreadPct: 0.002,
          trendPct: 0.01,
          rangePct: 0.02,
          volumeRatio: 1.2,
        },
        scores: {
          technicalScore: 0.7,
          newsScore: 0.5,
          marketScore: 0.6,
          riskScore: 0.8,
          liquidityScore: 0.7,
          volumeScore: 0.7,
          momentumScore: 0.75,
          finalScore: 0.7,
          confidence: 0.85,
        },
      },
      {
        symbol: "MSFT",
        action: "HOLD",
        decisionLabel: "HOLD",
        confidence: 0.4,
        reasons: ["hold"],
        riskWarnings: [],
        riskStatus: "low",
        timestamp: new Date().toISOString(),
        paperOnly: true,
        readyForManualPaperTrade: false,
        metrics: {
          last: 30,
          mid: 30,
          spreadPct: 0.002,
          trendPct: 0,
          rangePct: 0.01,
          volumeRatio: 1,
        },
        scores: {
          technicalScore: 0.5,
          newsScore: 0.5,
          marketScore: 0.5,
          riskScore: 0.5,
          liquidityScore: 0.5,
          volumeScore: 0.5,
          momentumScore: 0.5,
          finalScore: 0.5,
          confidence: 0.4,
        },
      },
    ],
  });
  assert.equal(snap.qualifiedCount, 1);
  assert.equal(
    snap.candidates.find((c) => c.symbol === "AAPL")?.qualified,
    true,
  );
  assert.equal(
    snap.candidates.find((c) => c.symbol === "MSFT")?.qualified,
    false,
  );
  console.log("✓ candidate ranking qualifies only ready BUY proposals");

  const emergencySrc = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "trading", "emergency.ts"),
    "utf8",
  );
  assert.ok(emergencySrc.includes("activateEmergencyStop"));
  assert.ok(emergencySrc.includes("closeAllOpenPositions"));
  assert.ok(emergencySrc.includes("openPositionsPreserved"));
  assert.ok(/preserve|Preserves open positions/i.test(emergencySrc));
  const activateBody = emergencySrc.slice(
    emergencySrc.indexOf("export async function activateEmergencyStop"),
    emergencySrc.indexOf("export async function closeAllOpenPositions"),
  );
  assert.ok(
    !activateBody.includes("closeAllPositions("),
    "activateEmergencyStop must not call closeAllPositions(",
  );
  console.log("✓ emergency stop preserves positions; close-all is separate");

  const closeSrc = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "app",
      "api",
      "auto-trade",
      "close-all",
      "route.ts",
    ),
    "utf8",
  );
  assert.ok(closeSrc.includes("confirm"));
  console.log("✓ close-all requires confirm:true");

  const bannerSrc = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "ui",
      "UnprotectedPositionsBanner.tsx",
    ),
    "utf8",
  );
  assert.ok(bannerSrc.includes("Unprotected open position"));
  assert.ok(bannerSrc.includes("Close All Positions"));
  console.log("✓ unprotected-position warning component present");

  const reconSrc = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "trading", "reconcile.ts"),
    "utf8",
  );
  assert.ok(reconSrc.includes("reconciliationComplete"));
  assert.ok(reconSrc.includes("orphanedPositions"));
  console.log("✓ restart reconciliation module present");

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
  const safetyUi = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "SafetyActionsCard.tsx",
    ),
    "utf8",
  );
  const advancedUi = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "components",
      "auto-trade",
      "AdvancedAutoTradeDetails.tsx",
    ),
    "utf8",
  );
  assert.ok(page.includes("SafetyActionsCard") || safetyUi.includes("Emergency Stop"));
  assert.ok(
    /Close [Aa]ll [Pp]ositions/.test(safetyUi) || /Close [Aa]ll [Pp]ositions/.test(page),
    "Auto Trade page must document Close All as a separate action",
  );
  assert.ok(
    safetyUi.includes("Open positions stay open") ||
      safetyUi.includes("preserves open positions") ||
      safetyUi.includes("Separate from Emergency Stop") ||
      safetyUi.includes("remain open"),
    "Emergency Stop must stay separate from Close All in UI copy",
  );
  assert.ok(advancedUi.includes("Top candidates") || page.includes("Top candidates"));
  assert.ok(!page.includes("AUTO_PAPER_TRADING_ENABLED=false"));
  assert.ok(
    page.includes("UnprotectedPositionsBanner"),
    "Auto Trade page must surface unprotected-position warnings",
  );
  console.log("✓ trader dashboard shows ops controls without env dump");

  assert.throws(
    () => assertPaperTradingOnly("https://api.alpaca.markets"),
    PaperTradingSafetyError,
  );
  console.log("✓ live trading endpoint blocked");

  await appendDecisionLog({
    symbol: "TEST",
    strategy: "verify",
    marketState: "open",
    indicators: {},
    confidence: 0.5,
    proposedTrade: {
      direction: "long",
      entry: 10,
      stopLoss: 9.8,
      takeProfit: 10.4,
    },
    riskValidation: {
      approved: false,
      code: "max_open_positions",
      reason: "test reject",
      qty: 0,
      notional: 0,
    },
    finalAction: "rejected_risk",
    rejectionReason: "test reject",
    alpacaOrderId: null,
    error: null,
  });
  const logs = await readDecisionLog(5);
  assert.ok(logs.some((l) => l.finalAction === "rejected_risk"));
  console.log("✓ rejected proposal logging");

  console.log("verify:auto-trade-risk passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
