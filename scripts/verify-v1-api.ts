/**
 * Group 12 — API behavior (deterministic; no live Alpaca mutations).
 * Invokes route handlers / guards with fixtures where safe.
 * Run: npm run verify:v1-api
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { POST as closeAllPost } from "../src/app/api/auto-trade/close-all/route";
import { GET as dailyDateGet } from "../src/app/api/auto-trade/daily-sessions/[date]/route";
import { assertCanEnableAutoTrading } from "../src/lib/auto-trade/enable-guards";
import {
  getEffectiveRuntimeSettings,
  resetRuntimeSettingsCacheForTests,
  setExecutionEnabled,
  setAutoTradingEnabled,
} from "../src/lib/auto-trade/runtime-settings/service";
import { withTempTradingData } from "./lib/v1-harness";
import {
  replaceV1LifecycleStoreForTests,
  applyTransition,
} from "../src/lib/trading/v1-lifecycle";
import { makeCandidate } from "./fixtures/v1-lifecycle-fixtures";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

async function main() {
  console.log("verify:v1-api starting…");
  const temp = await withTempTradingData();
  let failed = false;
  try {
    // Close All requires confirm:true — does not call broker when missing
    const noConfirm = await closeAllPost(
      new Request("http://localhost/api/auto-trade/close-all", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );
    assert.equal(noConfirm.status, 400);
    const noConfirmBody = (await noConfirm.json()) as {
      ok: boolean;
      error?: string;
    };
    assert.equal(noConfirmBody.ok, false);
    assert.ok(noConfirmBody.error?.toLowerCase().includes("confirm"));
    console.log("✓ Close All rejects missing confirmation");

    const typedFalse = await closeAllPost(
      new Request("http://localhost/api/auto-trade/close-all", {
        method: "POST",
        body: JSON.stringify({ confirm: false }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    assert.equal(typedFalse.status, 400);
    console.log("✓ Close All rejects confirm:false");

    // Historical session date validation
    const badDate = await dailyDateGet(new Request("http://localhost"), {
      params: Promise.resolve({ date: "not-a-date" }),
    });
    assert.equal(badDate.status, 400);
    const badBody = (await badDate.json()) as { error?: string };
    assert.ok(badBody.error?.includes("YYYY-MM-DD"));
    console.log("✓ daily session date validation returns safe error");

    const goodDate = await dailyDateGet(new Request("http://localhost"), {
      params: Promise.resolve({ date: "2026-07-16" }),
    });
    assert.equal(goodDate.status, 200);
    const goodBody = (await goodDate.json()) as {
      ok: boolean;
      paperOnly?: boolean;
      aaplShortExcluded?: boolean;
    };
    assert.equal(goodBody.ok, true);
    assert.equal(goodBody.paperOnly, true);
    assert.equal(goodBody.aaplShortExcluded, true);
    console.log("✓ daily session read endpoint is paper-only and AAPL-excluded");

    // Auto Trading enable guards
    await resetRuntimeSettingsCacheForTests();
    await setExecutionEnabled(false, "test");
    await setAutoTradingEnabled(false, "test");
    const off = await assertCanEnableAutoTrading();
    assert.equal(off.ok, false);
    if (!off.ok) assert.equal(off.code, "execution_off");
    console.log("✓ Auto Trading cannot enable while execution is off");

    await setExecutionEnabled(true, "test");
    const critical = applyTransition(
      makeCandidate({ symbol: "F" }),
      "RECONCILIATION_REQUIRED",
      "test critical",
    );
    await replaceV1LifecycleStoreForTests([critical]);
    const crit = await assertCanEnableAutoTrading();
    assert.equal(crit.ok, false);
    if (!crit.ok) assert.equal(crit.code, "lifecycle_critical");
    console.log("✓ Auto Trading cannot enable with critical lifecycle warnings");

    await replaceV1LifecycleStoreForTests([]);
    // Zero eligible when snapshot says 0 — write a minimal snapshot if service path uses data dir
    // Guard still passes without snapshot; document coverage via source + UI verify
    const settings = getEffectiveRuntimeSettings();
    assert.equal(settings.liveTradingAllowed, false);
    console.log("✓ runtime remains paper-only / liveTradingAllowed false");

    // APIs do not expose secrets / full env in route sources
    const routes = [
      "src/app/api/auto-trade/route.ts",
      "src/app/api/auto-trade/enable/route.ts",
      "src/app/api/auto-trade/emergency-stop/route.ts",
      "src/app/api/auto-trade/close-all/route.ts",
      "src/app/api/auto-trade/daily-status/route.ts",
      "src/app/api/auto-trade/v1-lifecycle/route.ts",
      "src/app/api/auto-trade/v1-strategy/route.ts",
    ];
    for (const r of routes) {
      const src = read(r);
      assert.ok(!/ALPACA_SECRET_KEY|APCA-API-SECRET/.test(src), r);
      assert.ok(!src.includes("JSON.stringify(process.env)"), r);
    }
    console.log("✓ Auto Trade API routes do not expose secrets or full env dumps");

    // Enable route wires guard
    const enableSrc = read("src/app/api/auto-trade/enable/route.ts");
    assert.ok(enableSrc.includes("assertCanEnableAutoTrading"));
    console.log("✓ enable route uses Auto Trading enable guards");

    // Emergency stop route exists and is separate
    const emSrc = read("src/app/api/auto-trade/emergency-stop/route.ts");
    assert.ok(emSrc.includes("activateEmergencyStop"));
    assert.ok(!emSrc.includes("closeAllOpenPositions"));
    console.log("✓ Emergency Stop API does not call Close All");

    console.log("verify:v1-api passed");
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    await temp.cleanup({ failed });
    await resetRuntimeSettingsCacheForTests();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
