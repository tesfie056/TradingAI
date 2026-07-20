/**
 * Phase I Milestone I-1 verification.
 * Run: npm run verify:learning-i1
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AlpacaBar } from "../src/lib/alpaca/types";
import {
  assertFeaturesExcludeOutcomes,
  assertNoLookaheadInFeatures,
  buildFeatureSnapshot,
  classifyMarketRegime,
  classifyTradeReview,
  filterBarsAsOf,
  learningApiJson,
  lockNestedSafety,
} from "../src/lib/learning";
import {
  assertStrategyImmutable,
  getChampionIdentity,
  readStrategyRegistry,
  registerStrategyVersion,
  updateStrategyStatus,
} from "../src/lib/strategy/registry";

function bar(t: string, c: number, h?: number, l?: number, v = 1000): AlpacaBar {
  return { t, o: c, h: h ?? c * 1.01, l: l ?? c * 0.99, c, v };
}

async function main() {
  console.log("verify:learning-i1 starting…");

  // Lookahead: future bars present but must not affect as-of features
  const decisionTime = "2026-06-01T15:00:00.000Z";
  const bars: AlpacaBar[] = [
    bar("2026-06-01T14:00:00.000Z", 10),
    bar("2026-06-01T14:30:00.000Z", 10.2),
    bar("2026-06-01T14:55:00.000Z", 10.4),
    bar("2026-06-01T15:30:00.000Z", 99), // future — must be ignored
    bar("2026-06-01T16:00:00.000Z", 100),
  ];
  const filtered = filterBarsAsOf(bars, decisionTime);
  assert.equal(filtered.length, 3);
  assert.ok(filtered.every((b) => Date.parse(b.t) <= Date.parse(decisionTime)));

  const features = assertNoLookaheadInFeatures(bars, decisionTime);
  assert.ok(features.currentPrice != null);
  assert.ok(features.currentPrice! < 50, "must not use future price 99/100");

  const snap = buildFeatureSnapshot({
    decisionId: "d1",
    symbol: "AAPL",
    decisionTime,
    strategyId: "paper-intelligence",
    strategyVersion: "v1.0.0",
    confidence: 0.7,
    bars5Min: bars,
    isMarketOpen: true,
  });
  assert.equal(snap.paperOnly, true);
  assert.ok(snap.asOfBarTime);
  assert.ok(Date.parse(snap.asOfBarTime!) <= Date.parse(decisionTime));
  assert.ok(!("realizedPnl" in snap.features));
  console.log("✓ no future data included in features");

  const event = {
    id: "e1",
    eventType: "proposal" as const,
    decisionId: "d1",
    symbol: "AAPL",
    decisionTime,
    strategyId: "paper-intelligence",
    strategyVersion: "v1.0.0",
    marketSession: "regular" as const,
    regime: snap.regime,
    featureSnapshotId: snap.id,
    confidence: 0.7,
    proposal: null,
    risk: null,
    order: null,
    outcomes: {
      exit: {
        exitPrice: 11,
        exitReason: "target",
        holdingDurationMs: 1000,
        mfe: 0.5,
        mae: -0.1,
        realizedPnl: 1,
        returnPct: 0.05,
        won: true,
      },
    },
    rejectionReason: null,
    paperOnly: true as const,
  };
  assertFeaturesExcludeOutcomes(snap, event);
  console.log("✓ dataset separates features vs outcomes");

  // Regime deterministic
  const r1 = classifyMarketRegime({
    broadTrendPct: 0.01,
    atrPct: 0.01,
    rangePct: 0.01,
    relativeVolume: 1.0,
    trendStrength: 2,
    vwapBias: "above",
    priceVsSmaFast: 0.01,
  });
  const r2 = classifyMarketRegime({
    broadTrendPct: 0.01,
    atrPct: 0.01,
    rangePct: 0.01,
    relativeVolume: 1.0,
    trendStrength: 2,
    vwapBias: "above",
    priceVsSmaFast: 0.01,
  });
  assert.equal(r1.regime, r2.regime);
  assert.equal(r1.regime, "trending_up");

  const hv = classifyMarketRegime({
    broadTrendPct: 0,
    atrPct: 0.05,
    rangePct: 0.05,
    relativeVolume: 1,
    trendStrength: 0,
    vwapBias: "near",
    priceVsSmaFast: 0,
  });
  assert.equal(hv.regime, "high_volatility");
  console.log("✓ market-regime labeling deterministic");

  // Reviews
  assert.equal(
    classifyTradeReview({
      entryFollowedStrategy: true,
      riskSizingCorrect: true,
      slippageAcceptable: true,
      realizedPnl: 10,
    }),
    "good_profitable",
  );
  assert.equal(
    classifyTradeReview({
      entryFollowedStrategy: true,
      riskSizingCorrect: true,
      slippageAcceptable: true,
      realizedPnl: -5,
    }),
    "good_losing",
  );
  assert.equal(
    classifyTradeReview({
      entryFollowedStrategy: false,
      riskSizingCorrect: true,
      slippageAcceptable: true,
      realizedPnl: 10,
    }),
    "bad_profitable",
  );
  assert.equal(
    classifyTradeReview({
      entryFollowedStrategy: false,
      riskSizingCorrect: false,
      slippageAcceptable: false,
      realizedPnl: -3,
    }),
    "bad_losing",
  );
  assert.equal(
    classifyTradeReview({
      entryFollowedStrategy: null,
      riskSizingCorrect: null,
      slippageAcceptable: null,
      realizedPnl: null,
    }),
    "insufficient_data",
  );
  console.log("✓ trade-review classifications");

  // Registry immutability
  const champ = getChampionIdentity();
  assert.equal(champ.strategyId, "paper-intelligence");
  assert.equal(champ.version, "v1.0.0");
  const reg = await readStrategyRegistry();
  assert.ok(reg.entries.some((e) => e.status === "CHAMPION"));

  const overwrite = await registerStrategyVersion({
    strategyId: "paper-intelligence",
    name: "Hack",
    version: "v1.0.0",
    status: "DRAFT",
    parentVersion: null,
    entryRules: "hack",
    exitRules: "hack",
    featureSet: [],
    parameterValues: {},
    supportedRegimes: [],
    supportedUniverse: "x",
    riskRequirements: [],
    backtestPeriod: { start: null, end: null },
    validationResults: null,
    paperTradingResults: null,
    rejectionReason: null,
    rollbackTarget: null,
  });
  assert.equal(overwrite.ok, false);
  console.log("✓ champion / existing version cannot be overwritten");

  const demote = await updateStrategyStatus({
    strategyId: "paper-intelligence",
    version: "v1.0.0",
    status: "RETIRED",
  });
  assert.equal(demote.ok, false);
  console.log("✓ champion cannot be demoted in I-1");

  const imm = await assertStrategyImmutable("paper-intelligence", "v1.0.0", {
    parameterValues: { technical: 0.99 },
  });
  assert.equal(imm.ok, false);
  console.log("✓ strategy version immutability enforced");

  const draftVersion = `v1.0.1-draft-${Date.now().toString(36)}`;
  const draft = await registerStrategyVersion({
    strategyId: "paper-intelligence",
    name: "Paper Intelligence experiment",
    version: draftVersion,
    status: "DRAFT",
    parentVersion: "v1.0.0",
    entryRules: "Same as v1 with experimental note",
    exitRules: "Unchanged",
    featureSet: ["rsi"],
    parameterValues: { technical: 0.32 },
    supportedRegimes: ["trending_up"],
    supportedUniverse: "same",
    riskRequirements: ["paper_only"],
    backtestPeriod: { start: null, end: null },
    validationResults: null,
    paperTradingResults: null,
    rejectionReason: null,
    rollbackTarget: "v1.0.0",
  });
  assert.equal(draft.ok, true);
  console.log("✓ new versions can be registered without touching champion");

  // UI / no promote actions mutating champion in Strategy Lab
  const lab = fs.readFileSync(
    path.join(process.cwd(), "src/components/strategy-lab/StrategyLabView.tsx"),
    "utf8",
  );
  assert.ok(lab.includes("Current Champion"));
  assert.ok(lab.includes("read-only") || lab.includes("Read-only"));
  assert.ok(!lab.includes("window.confirm"));
  assert.ok(!lab.includes("registerStrategyVersion"));
  assert.ok(!/Promote|approvePromotion/i.test(lab) || lab.includes("later milestones"));
  console.log("✓ Strategy Lab is read-only for I-1");

  const page = fs.readFileSync(
    path.join(process.cwd(), "src/app/strategy-lab/page.tsx"),
    "utf8",
  );
  assert.ok(page.trimStart().startsWith("import "));
  assert.ok(!page.includes("registerStrategyVersion"));
  assert.ok(!page.includes("Date.now()"));
  assert.ok(!/function StrategyLabPage[\s\S]*import /.test(page));
  assert.equal((page.match(/from ["']node:path["']/g) ?? []).length, 0);
  assert.equal((page.match(/from ["']path["']/g) ?? []).length, 0);
  console.log("✓ Strategy Lab page has valid imports and no render-time registration");

  const nav = fs.readFileSync(
    path.join(process.cwd(), "src/components/layout/StatusBar.tsx"),
    "utf8",
  );
  assert.ok(nav.includes("/strategy-lab"));
  console.log("✓ Strategy Lab nav linked");

  // Locked safety response helper — exactly once, overrides hostile input
  const hostile = learningApiJson({
    paperOnly: false,
    liveTradingAllowed: true,
    ok: false,
    baseline: { paperOnly: false, liveTradingAllowed: true },
  });
  assert.equal(hostile.ok, true);
  assert.equal(hostile.paperOnly, true);
  assert.equal(hostile.liveTradingAllowed, false);
  const serialized = JSON.stringify(hostile);
  assert.equal((serialized.match(/"paperOnly":true/g) ?? []).length >= 1, true);
  // Top-level keys exactly once in object
  const topKeys = Object.keys(hostile).filter((k) => k === "paperOnly");
  assert.equal(topKeys.length, 1);
  const liveKeys = Object.keys(hostile).filter((k) => k === "liveTradingAllowed");
  assert.equal(liveKeys.length, 1);
  assert.notEqual(hostile.liveTradingAllowed, true);
  console.log("✓ spread data cannot override locked safety fields");

  const lockedBaseline = lockNestedSafety({
    paperOnly: false as unknown as true,
    liveTradingAllowed: true as unknown as false,
    foo: 1,
  });
  assert.equal(lockedBaseline.paperOnly, true);
  assert.equal(lockedBaseline.liveTradingAllowed, false);

  // Simulated registry/summary API bodies
  const registryBody = learningApiJson({
    champion: { name: "Paper Intelligence v1" },
    entries: [],
    paperOnly: false,
    liveTradingAllowed: true,
  });
  assert.equal(registryBody.paperOnly, true);
  assert.equal(
    Object.keys(registryBody).filter((k) => k === "paperOnly").length,
    1,
  );
  console.log("✓ Registry API body returns paperOnly: true exactly once");

  const summaryBody = learningApiJson({
    baseline: lockedBaseline,
    dataset: {},
    paperOnly: false,
    liveTradingAllowed: true,
  });
  assert.equal(summaryBody.paperOnly, true);
  assert.equal(summaryBody.liveTradingAllowed, false);
  assert.equal(
    Object.keys(summaryBody).filter((k) => k === "paperOnly").length,
    1,
  );
  assert.equal(
    Object.keys(summaryBody).filter((k) => k === "liveTradingAllowed").length,
    1,
  );
  console.log("✓ Summary API body returns locked safety fields exactly once");

  // GET learning routes: read-only registry + learningApiJson (no writes on load)
  const summaryRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/learning/summary/route.ts"),
    "utf8",
  );
  const registryRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/learning/registry/route.ts"),
    "utf8",
  );
  const baselineRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/learning/baseline/route.ts"),
    "utf8",
  );
  for (const src of [summaryRoute, registryRoute, baselineRoute]) {
    assert.ok(src.includes("learningApiJson"));
    assert.ok(!src.includes("registerStrategyVersion"));
    assert.ok(!src.includes("ensureStrategyRegistryPersisted"));
  }
  assert.ok(summaryRoute.includes("readStrategyRegistry"));
  assert.ok(registryRoute.includes("readStrategyRegistry"));
  assert.ok(!summaryRoute.includes("...monitorSafetyFlags()"));
  assert.ok(!registryRoute.includes("...monitorSafetyFlags()"));
  console.log("✓ GET learning APIs use read-only registry + locked response helper");

  const before = await readStrategyRegistry();
  const beforeCount = before.entries.length;
  await readStrategyRegistry();
  await readStrategyRegistry();
  const after = await readStrategyRegistry();
  assert.equal(after.entries.length, beforeCount);
  console.log("✓ Loading/refreshing registry read path does not create versions");

  // No live-trading field can become true via helper
  const attempt = learningApiJson({ liveTradingAllowed: true, paperOnly: false });
  assert.equal(attempt.liveTradingAllowed, false);
  assert.equal(attempt.paperOnly, true);
  console.log("✓ no live-trading field can become true");

  console.log("verify:learning-i1 passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
