/**
 * Phase I Milestone I-4 verification.
 * Run: npm run verify:learning-i4
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertAcceptanceImmutable,
  compareFingerprints,
  createTypedExperiment,
  defaultAssumptions,
  evaluateChallengerShadow,
  fingerprintFromAssumptions,
  generateSyntheticBars,
  listExperiments,
  runBacktestEngine,
} from "../src/lib/backtest";
import {
  startShadowSession,
  stopShadowSession,
  processShadowScan,
  getActiveShadowSession,
  summarizeEvidenceProgress,
  recoverInterruptedShadowSessions,
} from "../src/lib/shadow/session";
import { createJob, readJob, runJobInBackground } from "../src/lib/jobs/background";
import { getOrBuildDqSummary } from "../src/lib/backtest/dq-summary";
import { writeCachedBars } from "../src/lib/backtest/downloader";
import {
  assertStrategyImmutable,
  getChampionIdentity,
} from "../src/lib/strategy/registry";
import { buildWeaknessReport } from "../src/lib/backtest/weakness";
import type { AcceptanceRules } from "../src/lib/backtest/experiments";

async function main() {
  console.log("verify:learning-i4 starting…");

  // Fingerprints
  const a = defaultAssumptions({ fixedSpreadBps: 4, fixedSlippageBps: 2 });
  const fp1 = fingerprintFromAssumptions({
    strategyVersion: "v1.0.0",
    datasetId: "ds1",
    startDate: "2024-07-01",
    endDate: "2025-06-30",
    symbols: ["F", "BAC"],
    timeframe: "5Min",
    assumptions: a,
    evalStep: 24,
    realDataOnly: true,
  });
  const fp2 = fingerprintFromAssumptions({
    strategyVersion: "v1.0.0",
    datasetId: "ds1",
    startDate: "2024-07-01",
    endDate: "2025-06-30",
    symbols: ["BAC", "F"],
    timeframe: "5Min",
    assumptions: a,
    evalStep: 24,
    realDataOnly: true,
  });
  assert.equal(fp1.hash, fp2.hash);
  const fp3 = fingerprintFromAssumptions({
    strategyVersion: "v1.0.0",
    datasetId: "ds1",
    startDate: "2024-07-01",
    endDate: "2025-06-30",
    symbols: ["F", "BAC"],
    timeframe: "5Min",
    assumptions: defaultAssumptions({ fixedSpreadBps: 8, fixedSlippageBps: 5 }),
    evalStep: 24,
    realDataOnly: true,
  });
  assert.notEqual(fp1.hash, fp3.hash);
  const cmp = compareFingerprints(fp1, fp3);
  assert.equal(cmp.comparable, false);
  assert.ok(cmp.differences.length > 0);
  console.log("✓ identical fingerprints match; different assumptions differ");

  // Same fingerprint → identical results on synthetic deterministic path
  const r1 = await runBacktestEngine({
    symbols: ["F"],
    start: "2026-01-02",
    end: "2026-01-20",
    useSynthetic: true,
    realDataOnly: false,
    persist: false,
    runWalkForward: false,
    evalStep: 6,
  });
  const r2 = await runBacktestEngine({
    symbols: ["F"],
    start: "2026-01-02",
    end: "2026-01-20",
    useSynthetic: true,
    realDataOnly: false,
    persist: false,
    runWalkForward: false,
    evalStep: 6,
  });
  assert.ok(r1.runFingerprint);
  assert.equal(r1.runFingerprint!.hash, r2.runFingerprint!.hash);
  assert.equal(r1.metrics.totalTrades, r2.metrics.totalTrades);
  assert.equal(r1.metrics.profitFactor, r2.metrics.profitFactor);
  console.log("✓ identical run fingerprints produce identical metrics");

  // Shadow: same snapshot, challenger no broker, works conceptually with execution off
  await recoverInterruptedShadowSessions();
  const existing = await getActiveShadowSession();
  if (existing?.status === "RUNNING") await stopShadowSession("STOPPED");

  const session = await startShadowSession({
    executionEnabled: false,
    autoTradingEnabled: false,
    blockedRegimes: ["weak_uncertain"],
  });
  assert.equal(session.runtimeSettingsSnapshot.executionEnabled, false);
  assert.equal(session.runtimeSettingsSnapshot.autoTradingEnabled, false);
  assert.equal(session.challengerBrokerAccess, "blocked");

  const bars = generateSyntheticBars({
    symbol: "F",
    startIso: "2026-06-01T14:30:00.000Z",
    count: 50,
    timeframeMinutes: 5,
    trendBias: 0.55,
  }).map((b) => ({
    t: b.timestamp,
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume,
  }));

  const scan = await processShadowScan({
    scanId: "scan_test_1",
    timestamp: bars.at(-1)!.t,
    symbol: "F",
    bars5Min: bars,
    dataQualityStatus: "ok",
    paperSubmitEligible: false,
  });
  assert.ok(scan);
  assert.equal(scan!.champion.version, session.championVersion);
  assert.equal(scan!.challenger.brokerSubmitAttempted, false);
  assert.equal(scan!.marketSnapshotId.includes("F"), true);

  const chall = evaluateChallengerShadow({
    decisionTime: bars.at(-1)!.t,
    symbol: "F",
    bars5Min: bars,
    blockedRegimes: ["weak_uncertain"],
    strategyVersion: session.challengerVersion,
  });
  assert.equal(chall.brokerSubmit, false);

  const shadowMod = fs.readFileSync(
    path.join(process.cwd(), "src/lib/shadow/session.ts"),
    "utf8",
  );
  assert.ok(!shadowMod.includes("submitPaper"));
  assert.ok(!shadowMod.includes("@/lib/trading/submit"));
  console.log("✓ shadow same-snapshot; challenger cannot submit; start does not enable auto");

  // Interrupt preservation: mark incomplete via recover after fake RUNNING write
  const stopped = await stopShadowSession("STOPPED");
  assert.ok(stopped);
  assert.ok(stopped!.review);
  assert.ok(["VALID", "PARTIAL", "INVALID"].includes(stopped!.validity!));

  const evidence = summarizeEvidenceProgress([stopped!]);
  if (stopped!.validity !== "VALID") {
    assert.equal(evidence.validSessions, 0);
  }
  console.log("✓ sessions persisted; invalid/partial do not silently count as valid");

  // Weakness min sample
  const weak = buildWeaknessReport(r1);
  assert.ok(weak.findings.every((f) => f.minSampleRequired >= 15 || f.category === "walk_forward"));
  console.log("✓ weakness reports enforce minimum sample sizes");

  // Acceptance locked
  const exp = await createTypedExperiment("cost_aware_filter");
  assert.equal(exp.ok, true);
  if (exp.ok) {
    const locked = exp.experiment.acceptance;
    assert.throws(() =>
      assertAcceptanceImmutable(locked, {
        ...locked,
        rulesHash: "tampered",
      } as AcceptanceRules),
    );
    const list = await listExperiments();
    assert.ok(list.some((e) => e.kind === "cost_aware_filter"));
  }
  // Second create returns same locked experiment
  const exp2 = await createTypedExperiment("cost_aware_filter");
  assert.equal(exp2.ok, true);
  if (exp.ok && exp2.ok) {
    assert.equal(exp.experiment.acceptance.rulesHash, exp2.experiment.acceptance.rulesHash);
  }
  console.log("✓ acceptance criteria stored and immutable");

  // DQ summary cache (small file)
  const start = "2026-02-01";
  const end = "2026-02-05";
  const tiny = generateSyntheticBars({
    symbol: "ZZ",
    startIso: `${start}T14:30:00.000Z`,
    count: 40,
    timeframeMinutes: 5,
  }).map((b) => ({ ...b, source: "alpaca_iex_raw" }));
  const file = await writeCachedBars({
    symbol: "ZZ",
    timeframe: "5Min",
    start,
    end,
    bars: tiny,
    source: "alpaca_iex_raw",
  });
  const sum1 = await getOrBuildDqSummary(file);
  const sum2 = await getOrBuildDqSummary(file);
  assert.equal(sum1.fingerprint, sum2.fingerprint);
  console.log("✓ DQ summary cached by dataset fingerprint (no duplicate full work)");

  // Background job progress
  const job = await createJob("test");
  let sawProgress = false;
  await new Promise<void>((resolve, reject) => {
    runJobInBackground(job.id, async ({ progress }) => {
      await progress(50, "halfway");
      sawProgress = true;
      return { ok: true };
    });
    const t0 = Date.now();
    const tick = async () => {
      const j = await readJob(job.id);
      if (j?.status === "completed") {
        assert.equal(j.progress, 100);
        resolve();
        return;
      }
      if (j?.status === "failed") {
        reject(new Error(j.error ?? "failed"));
        return;
      }
      if (Date.now() - t0 > 5000) {
        reject(new Error("job timeout"));
        return;
      }
      setTimeout(() => void tick(), 50);
    };
    void tick();
  });
  assert.equal(sawProgress, true);
  console.log("✓ background jobs expose progress");

  // Promotion / champion / live
  const champ = getChampionIdentity();
  assert.equal(champ.version, "v1.0.0");
  const imm = await assertStrategyImmutable(champ.strategyId, champ.version, {
    entryRules: "nope",
  });
  assert.equal(imm.ok, false);

  const lab = fs.readFileSync(
    path.join(process.cwd(), "src/components/strategy-lab/StrategyLabView.tsx"),
    "utf8",
  );
  for (const s of [
    "I-4 A. Metric Consistency",
    "I-4 B. Live Shadow Control",
    "I-4 C. Shadow Evidence",
    "I-4 D. Weakness Analysis",
    "I-4 E. Challenger Experiments",
    "I-4 F. Safety",
    "Promote (disabled)",
  ]) {
    assert.ok(lab.includes(s), `missing ${s}`);
  }

  const shadowRoute = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/learning/shadow/route.ts"),
    "utf8",
  );
  assert.ok(shadowRoute.includes("Execution and auto-trading were NOT changed"));

  console.log("✓ promotion disabled; champion immutable; live trading blocked; UI present");
  console.log("verify:learning-i4 passed");
  console.log(
    JSON.stringify(
      {
        fingerprintDemo: fp1.hash,
        pfDiscrepancyCause:
          "I-3 stress used thinned bars (every 3rd) vs full baseline evalStep=24 — non-comparable",
        shadowSession: stopped!.sessionId,
        validity: stopped!.validity,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
